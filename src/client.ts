/** HTTP client for the cloro API. */
import {
  APIConnectionError,
  APIStatusError,
  APITimeoutError,
  AuthenticationError,
  BadRequestError,
  CloroError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "./errors.js";
import { AsyncTasksResource } from "./resources/async-tasks.js";
import { MonitorResource } from "./resources/monitor.js";
import { VERSION } from "./version.js";

const DEFAULT_BASE_URL = "https://api.cloro.dev";
const DEFAULT_TIMEOUT = 60_000; // ms
const DEFAULT_MAX_RETRIES = 2;

type StatusErrorCtor = new (message: string, options?: APIStatusErrorInit) => APIStatusError;

interface APIStatusErrorInit {
  statusCode?: number;
  response?: Response;
  body?: unknown;
}

const STATUS_MAP: Record<number, StatusErrorCtor> = {
  400: BadRequestError,
  401: AuthenticationError,
  403: PermissionDeniedError,
  404: NotFoundError,
  409: ConflictError,
  // The async task endpoints return 422 for schema validation failures and
  // never 400, so both map to BadRequestError.
  422: BadRequestError,
  429: RateLimitError,
};

// Status codes that are safe to retry with backoff.
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

/** A `fetch`-compatible function. Inject one for testing or a custom transport. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CloroOptions {
  /** Your cloro API key (`sk_live_...`). Falls back to `CLORO_API_KEY`. */
  apiKey?: string;
  /** Override the API base URL (default `https://api.cloro.dev`). */
  baseUrl?: string;
  /** Per-request timeout in milliseconds (default 60000). */
  timeout?: number;
  /** Retries for timeouts, connection errors, and 429/5xx (default 2). */
  maxRetries?: number;
  /** Inject a `fetch` implementation (custom transport, testing). */
  fetch?: FetchLike;
}

export interface RequestOptions {
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
}

/** Exponential backoff: 500ms, 1s, 2s, ... capped at 8s. */
function backoff(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 8000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse a `Retry-After` header (seconds) into milliseconds, if present. */
function parseRetryAfter(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

async function makeStatusError(response: Response): Promise<APIStatusError> {
  let text = "";
  let body: unknown = null;
  try {
    text = await response.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  let message: string | undefined;
  if (body && typeof body === "object") {
    const err = (body as { error?: unknown }).error;
    if (err && typeof err === "object") {
      message = (err as { message?: string }).message;
    } else if (typeof err === "string") {
      message = err;
    }
  }
  message = message || text || `HTTP ${response.status}`;

  let Ctor = STATUS_MAP[response.status];
  if (!Ctor) {
    Ctor = response.status >= 500 ? InternalServerError : APIStatusError;
  }
  return new Ctor(message, { statusCode: response.status, response, body });
}

function envApiKey(): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const value = proc?.env?.CLORO_API_KEY;
  return typeof value === "string" ? value : undefined;
}

/**
 * Client for the cloro API.
 *
 * One API for Google Search and every AI answer engine (ChatGPT, Gemini,
 * Perplexity, Copilot, Grok, AI Overview, AI Mode). Real-time, structured JSON.
 *
 * @example
 * ```ts
 * import { Cloro } from "cloro";
 *
 * const client = new Cloro({ apiKey: "sk_live_..." }); // or set CLORO_API_KEY
 * const res = await client.monitor.chatgpt({
 *   prompt: "What do you know about Acme Corp?",
 *   country: "US",
 *   include: { markdown: true },
 * });
 * console.log(res.result.text);
 * ```
 */
export class Cloro {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly maxRetries: number;

  private readonly timeout: number;
  private readonly fetchImpl: FetchLike;

  readonly monitor: MonitorResource;
  readonly asyncTasks: AsyncTasksResource;

  constructor(options: CloroOptions | string = {}) {
    const opts: CloroOptions = typeof options === "string" ? { apiKey: options } : options;

    const apiKey = opts.apiKey ?? envApiKey();
    if (!apiKey) {
      throw new CloroError(
        "No API key provided. Pass { apiKey } or set the CLORO_API_KEY environment variable.",
      );
    }

    const fetchImpl = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchImpl) {
      throw new CloroError(
        "No fetch implementation available. Use Node 18+ or pass { fetch } explicitly.",
      );
    }

    this.apiKey = apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.fetchImpl = opts.fetch ? fetchImpl : fetchImpl.bind(globalThis);

    this.monitor = new MonitorResource(this);
    this.asyncTasks = new AsyncTasksResource(this);
  }

  // -- reference data ---------------------------------------------------

  /** List supported countries, optionally filtered by engine `model`. */
  countries(model?: string): Promise<unknown> {
    return this.request({
      method: "GET",
      path: "/v1/countries",
      query: model ? { model } : undefined,
    });
  }

  /** List supported US states (for location-targeted Google requests). */
  states(): Promise<unknown> {
    return this.request({ method: "GET", path: "/v1/states" });
  }

  // -- transport --------------------------------------------------------

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": `cloro-node/${VERSION}`,
    };
  }

  async request(options: RequestOptions): Promise<any> {
    const { method, path, body, query } = options;

    let url = `${this.baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) params.append(key, value);
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    let attempt = 0;
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: this.headers(),
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError";
        if (attempt < this.maxRetries) {
          attempt += 1;
          await sleep(backoff(attempt));
          continue;
        }
        if (aborted) throw new APITimeoutError(`Request to ${url} timed out`);
        throw new APIConnectionError(err instanceof Error ? err.message : String(err));
      } finally {
        clearTimeout(timer);
      }

      if (response.status >= 400) {
        if (RETRY_STATUS.has(response.status) && attempt < this.maxRetries) {
          attempt += 1;
          const retryAfter = parseRetryAfter(response);
          await sleep(retryAfter ?? backoff(attempt));
          continue;
        }
        throw await makeStatusError(response);
      }

      const text = await response.text();
      return text ? JSON.parse(text) : null;
    }
  }
}
