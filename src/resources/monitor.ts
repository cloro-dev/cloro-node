/** Synchronous monitor endpoints — one call per AI engine or Google Search. */
import type { Cloro } from "../client.js";

/** Extra output formats to request, e.g. `{ markdown: true, html: true }`. */
export type IncludeOptions = Record<string, unknown>;

/** Parameters for the prompt-based AI answer engines. */
export interface EngineParams {
  prompt: string;
  country: string;
  include?: IncludeOptions;
  [key: string]: unknown;
}

/** Parameters for Google Search (SERP). */
export interface GoogleParams {
  query: string;
  country: string;
  location?: string;
  uule?: string;
  device?: string;
  pages?: number;
  include?: IncludeOptions;
  [key: string]: unknown;
}

/** Parameters for Google News. */
export interface GoogleNewsParams {
  query: string;
  country: string;
  include?: IncludeOptions;
  [key: string]: unknown;
}

/** Drop keys whose value is `undefined` so they aren't serialized. */
function pruneUndefined(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Real-time `POST /v1/monitor/*` endpoints.
 *
 * Each method resolves once the engine responds, with the parsed
 * `{ success, result }` envelope. For high-volume or long-running work, prefer
 * the async task queue ({@link Cloro.asyncTasks}).
 */
export class MonitorResource {
  constructor(private readonly client: Cloro) {}

  private run(path: string, body: Record<string, unknown>): Promise<any> {
    return this.client.request({ method: "POST", path, body: pruneUndefined(body) });
  }

  // -- AI answer engines (prompt-based) -------------------------------

  /** Monitor ChatGPT. `POST /v1/monitor/chatgpt`. */
  chatgpt(params: EngineParams): Promise<any> {
    return this.run("/v1/monitor/chatgpt", params);
  }

  /** Monitor Google Gemini. `POST /v1/monitor/gemini`. */
  gemini(params: EngineParams): Promise<any> {
    return this.run("/v1/monitor/gemini", params);
  }

  /** Monitor Perplexity. `POST /v1/monitor/perplexity`. */
  perplexity(params: EngineParams): Promise<any> {
    return this.run("/v1/monitor/perplexity", params);
  }

  /** Monitor Microsoft Copilot. `POST /v1/monitor/copilot`. */
  copilot(params: EngineParams): Promise<any> {
    return this.run("/v1/monitor/copilot", params);
  }

  /** Monitor Grok. `POST /v1/monitor/grok`. */
  grok(params: EngineParams): Promise<any> {
    return this.run("/v1/monitor/grok", params);
  }

  /** Monitor Google AI Mode. `POST /v1/monitor/aimode`. */
  aimode(params: EngineParams): Promise<any> {
    return this.run("/v1/monitor/aimode", params);
  }

  // -- Google Search (query-based) ------------------------------------

  /** Monitor Google Search (SERP). `POST /v1/monitor/google`. */
  google(params: GoogleParams): Promise<any> {
    return this.run("/v1/monitor/google", params);
  }

  /** Monitor Google News. `POST /v1/monitor/google/news`. */
  googleNews(params: GoogleNewsParams): Promise<any> {
    return this.run("/v1/monitor/google/news", params);
  }
}
