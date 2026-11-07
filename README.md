# cloro TypeScript / Node SDK

The official JS SDK for [**cloro**](https://cloro.dev), for TypeScript and Node.
cloro is a SERP API with one API for Google Search and every AI answer engine
(ChatGPT, Gemini, AI Overview, AI Mode, Bing AI Mode). Real-time, structured JSON.

cloro also has an official Python SDK,
[`cloro` on PyPI](https://pypi.org/project/cloro/), and a hosted
[MCP server for Claude, Cursor and ChatGPT](https://cloro.dev/integrations/mcp/),
so an AI agent can call the same endpoints as tools.

Use the SDK, or [just `curl` it](https://cloro.dev/docs): same clean response
either way. The SDK adds typed methods, sensible retries, and a polling helper
for the async task queue so you don't hand-roll it. Ships with TypeScript types
and both ESM and CommonJS builds.

## Installation

```bash
npm install @cloro-dev/cloro
```

Requires Node 18+ (uses the built-in `fetch`). Works with TypeScript, ESM, and
CommonJS.

## Quickstart

```ts
import { Cloro } from "@cloro-dev/cloro";

const client = new Cloro({ apiKey: "sk_live_..." }); // or set CLORO_API_KEY

const res = await client.monitor.chatgpt({
  prompt: "What do you know about Acme Corp?",
  country: "US",
  include: { markdown: true },
});

console.log(res.result.text);
for (const source of res.result.sources) {
  console.log(source.position, source.url, source.label);
}
```

The API key is read from the `CLORO_API_KEY` environment variable when you don't
pass `apiKey`. Get a key (and 500 free credits) at
[dashboard.cloro.dev](https://dashboard.cloro.dev/).

<details>
<summary>CommonJS</summary>

```js
const { Cloro } = require("@cloro-dev/cloro");

const client = new Cloro({ apiKey: "sk_live_..." });
client.monitor.chatgpt({ prompt: "...", country: "US" }).then((res) => {
  console.log(res.result.text);
});
```

</details>

## Engines

Every engine is a method on `client.monitor`. AI engines take a `prompt`;
Google Search and Google News take a `query`.

```ts
await client.monitor.chatgpt({ prompt: "...", country: "US" });
await client.monitor.gemini({ prompt: "...", country: "US" });
await client.monitor.aimode({ prompt: "...", country: "US" }); // Google AI Mode
await client.monitor.bingAimode({ prompt: "...", country: "US" }); // Bing AI Mode

await client.monitor.google({ query: "best crm", country: "US", pages: 1 });
await client.monitor.googleNews({ query: "acme corp", country: "US" });
```

Pass `include: { ... }` to request extra formats — `markdown`, `html`,
`searchQueries`, `shopping`, and more, depending on the engine.

Bing AI Mode accepts only `include: { markdown, html }`. The `html` value is a
URL to the page that Bing shows. You can also set `state` to a two-letter US state code
(only with `country: "US"`). The result has `text`, `sources`, and
`citationPills`.

```ts
const bing = await client.monitor.bingAimode({
  prompt: "best crm for startups",
  country: "US",
  state: "CA",
  include: { markdown: true },
});
for (const pill of bing.result.citationPills) {
  console.log(pill.position, pill.domain, pill.url);
}
```

## Async task queue

For high-volume or long-running work, enqueue tasks and poll them to completion.
`run()` does create-then-wait in one call:

```ts
const result = await client.asyncTasks.run({
  taskType: "CHATGPT",
  payload: { prompt: "What is cloro?", country: "US" },
});
console.log(result.response); // present once COMPLETED
console.log(result.credits); // credits reserved / charged
```

Prefer to manage the lifecycle yourself:

```ts
const task = await client.asyncTasks.create({
  taskType: "GOOGLE",
  payload: { query: "serp api", country: "US" },
  priority: 5,
});
const snapshot = await client.asyncTasks.retrieve(task); // non-blocking
const done = await client.asyncTasks.wait(task, { timeout: 120_000, pollInterval: 2000 });
```

Batch up to 500 tasks in a single request (results preserve input order):

```ts
const results = await client.asyncTasks.createBatch([
  { taskType: "CHATGPT", payload: { prompt: "q1", country: "US" } },
  { taskType: "GEMINI", payload: { prompt: "q2", country: "GB" } },
]);
for (const item of results) {
  if (item.success) await client.asyncTasks.wait(item.task.id);
  else console.log("failed:", item.error.message);
}
```

Queue-wide status:

```ts
await client.asyncTasks.status(); // queued / processing counts, concurrency usage
```

Valid `taskType` values: `CHATGPT`, `GEMINI`, `AIMODE`, `BING_AIMODE`, `GOOGLE`,
`GOOGLE_NEWS`.

## Configuration

```ts
const client = new Cloro({
  apiKey: "sk_live_...",
  baseUrl: "https://api.cloro.dev", // override if needed
  timeout: 300_000, // per-request milliseconds (the default)
  maxRetries: 2, // timeouts, connection errors, 429/5xx
});
```

## Error handling

All errors subclass `CloroError`. HTTP failures map to status-specific types:

```ts
import { Cloro, AuthenticationError, RateLimitError, CloroError } from "@cloro-dev/cloro";

try {
  await client.monitor.chatgpt({ prompt: "...", country: "US" });
} catch (err) {
  if (err instanceof AuthenticationError) {
    // 401 — bad or missing API key
  } else if (err instanceof RateLimitError) {
    // 429 — the client already retried; back off further if it persists
  } else if (err instanceof CloroError) {
    // everything else
  } else {
    throw err;
  }
}
```

`BadRequestError` (400), `PermissionDeniedError` (403), `NotFoundError` (404),
`ConflictError` (409), and `InternalServerError` (5xx) are also available, along
with `TaskFailedError` / `TaskTimeoutError` from the poller and
`APITimeoutError` / `APIConnectionError` from the transport.

## Reference data

```ts
await client.countries(); // supported countries
await client.countries("chatgpt");
await client.countries("bing_aimode"); // countries for Bing AI Mode
await client.states(); // US states for location targeting (Google, Bing AI Mode)
```

## Links

- [cloro.dev](https://cloro.dev) — the hosted SERP + AI answer-engine API
- [SERP API](https://cloro.dev/serp-api/) — the Google Search endpoint this SDK wraps
- [Node & TypeScript guide](https://cloro.dev/integrations/javascript/) — quickstart, recipes, and production patterns
- [Docs](https://cloro.dev/docs) and [API reference (OpenAPI)](https://cloro.dev/docs/api-reference/openapi.json)
- [Pricing](https://cloro.dev/pricing/) · [Dashboard](https://dashboard.cloro.dev/)
- Python SDK: [cloro](https://github.com/cloro-dev/cloro-python)

## License

MIT
