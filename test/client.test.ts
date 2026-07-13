// Unit tests — no network; all HTTP is served by an injected fetch mock.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AuthenticationError,
  Cloro,
  CloroError,
  RateLimitError,
  TaskFailedError,
  TaskTimeoutError,
} from "../src/index.js";
import type { CloroOptions, FetchLike } from "../src/index.js";

// The SDK targets the DOM lib for web types (fetch/Response) and avoids a hard
// dependency on @types/node; these tests run under vitest (Node), so declare
// the one Node global they touch rather than pulling in conflicting node types.
declare const process: { env: Record<string, string | undefined> };

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function makeClient(handler: Handler, options: Partial<CloroOptions> = {}): Cloro {
  const fetchMock: FetchLike = async (url, init) => handler(url, init ?? {});
  return new Cloro({ apiKey: "sk_test", fetch: fetchMock, ...options });
}

function json(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("Cloro client", () => {
  const prevKey = process.env.CLORO_API_KEY;
  beforeEach(() => {
    delete process.env.CLORO_API_KEY;
  });
  afterEach(() => {
    if (prevKey === undefined) delete process.env.CLORO_API_KEY;
    else process.env.CLORO_API_KEY = prevKey;
  });

  it("requires an API key", () => {
    expect(() => new Cloro()).toThrow(CloroError);
  });

  it("reads the API key from the environment", () => {
    process.env.CLORO_API_KEY = "sk_env";
    expect(new Cloro({ fetch: (async () => json(200, {})) as FetchLike }).apiKey).toBe("sk_env");
  });

  it("sends the request and parses the response for monitor.chatgpt", async () => {
    const seen: Record<string, unknown> = {};
    const client = makeClient((url, init) => {
      seen.url = url;
      seen.auth = (init.headers as Record<string, string>).Authorization;
      seen.body = init.body;
      return json(200, { success: true, result: { text: "hi" } });
    });

    const res = await client.monitor.chatgpt({
      prompt: "hello",
      country: "US",
      include: { markdown: true },
    });

    expect(res.result.text).toBe("hi");
    expect(seen.url).toBe("https://api.cloro.dev/v1/monitor/chatgpt");
    expect(seen.auth).toBe("Bearer sk_test");
    expect(seen.body).toContain('"prompt":"hello"');
    expect(seen.body).toContain('"markdown":true');
  });

  it("uses the google endpoint with a query", async () => {
    let seenUrl = "";
    const client = makeClient((url) => {
      seenUrl = url;
      return json(200, { success: true, result: {} });
    });
    await client.monitor.google({ query: "best crm", country: "US", pages: 2 });
    expect(seenUrl.endsWith("/v1/monitor/google")).toBe(true);
  });

  it("drops undefined values from the body", async () => {
    let body = "";
    const client = makeClient((_url, init) => {
      body = String(init.body);
      return json(200, { success: true, result: {} });
    });
    await client.monitor.chatgpt({ prompt: "x", country: "US" }); // include omitted
    expect(body).not.toContain("include");
  });

  it("maps status codes to typed errors", async () => {
    const client = makeClient(() => json(401, { error: { message: "bad key" } }));
    const err = await client.monitor.chatgpt({ prompt: "x", country: "US" }).catch((e) => e);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.statusCode).toBe(401);
    expect(String(err)).toContain("bad key");
  });

  it("retries a 429 then succeeds", async () => {
    let calls = 0;
    const client = makeClient(
      () => {
        calls += 1;
        if (calls === 1) return json(429, { error: "slow down" }, { "retry-after": "0" });
        return json(200, { success: true, result: { text: "ok" } });
      },
      { maxRetries: 2 },
    );
    const res = await client.monitor.chatgpt({ prompt: "x", country: "US" });
    expect(res.result.text).toBe("ok");
    expect(calls).toBe(2);
  });

  it("exhausts retries and raises RateLimitError", async () => {
    const client = makeClient(() => json(429, { error: "slow down" }, { "retry-after": "0" }), {
      maxRetries: 1,
    });
    await expect(client.monitor.chatgpt({ prompt: "x", country: "US" })).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });
});

describe("async task queue", () => {
  it("create returns a task handle", async () => {
    const client = makeClient(() =>
      json(200, {
        success: true,
        task: {
          id: "t-1",
          taskType: "CHATGPT",
          status: "QUEUED",
          priority: 1,
          createdAt: "2026-04-09T15:00:00.000Z",
        },
        credits: { creditsToCharge: 5, creditsCharged: null },
      }),
    );
    const task = await client.asyncTasks.create({
      taskType: "CHATGPT",
      payload: { prompt: "x", country: "US" },
    });
    expect(task.id).toBe("t-1");
    expect(task.status).toBe("QUEUED");
  });

  it("wait polls until COMPLETED", async () => {
    const states = ["QUEUED", "PROCESSING", "COMPLETED"];
    let n = 0;
    const client = makeClient(() => {
      const state = states[n++];
      const body: Record<string, unknown> = { task: { id: "t-1", status: state } };
      if (state === "COMPLETED") body.response = { success: true, result: { text: "done" } };
      return json(200, body);
    });
    const result = await client.asyncTasks.wait("t-1", { pollInterval: 0, backoff: 1 });
    expect(result.task.status).toBe("COMPLETED");
    expect(result.response.result.text).toBe("done");
  });

  it("wait rejects on FAILED", async () => {
    const client = makeClient(() => json(200, { task: { id: "t-1", status: "FAILED" } }));
    await expect(client.asyncTasks.wait("t-1", { pollInterval: 0 })).rejects.toBeInstanceOf(
      TaskFailedError,
    );
  });

  it("wait times out", async () => {
    const client = makeClient(() => json(200, { task: { id: "t-1", status: "QUEUED" } }));
    await expect(
      client.asyncTasks.wait("t-1", { pollInterval: 0, timeout: 0 }),
    ).rejects.toBeInstanceOf(TaskTimeoutError);
  });

  it("createBatch returns the results array", async () => {
    const client = makeClient(() =>
      json(200, {
        success: true,
        summary: { total: 2, succeeded: 1, failed: 1 },
        results: [
          { success: true, index: 0, task: { id: "t-1", status: "QUEUED" } },
          { success: false, index: 1, error: { code: "VALIDATION_ERROR", message: "bad" } },
        ],
      }),
    );
    const results = await client.asyncTasks.createBatch([
      { taskType: "CHATGPT", payload: { prompt: "a", country: "US" } },
      { taskType: "CHATGPT", payload: {} },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].task.id).toBe("t-1");
    expect(results[1].error.code).toBe("VALIDATION_ERROR");
  });
});
