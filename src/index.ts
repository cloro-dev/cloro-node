/**
 * cloro — the official TypeScript/Node SDK.
 *
 * One API for Google Search and every AI answer engine (ChatGPT, Gemini,
 * Perplexity, Copilot, Grok, AI Overview, AI Mode). Real-time, structured JSON.
 *
 * ```ts
 * import { Cloro } from "cloro";
 *
 * const client = new Cloro({ apiKey: "sk_live_..." });
 * const res = await client.monitor.chatgpt({ prompt: "What is cloro?", country: "US" });
 * console.log(res.result.text);
 * ```
 */
export { Cloro } from "./client.js";
export type { CloroOptions, RequestOptions, FetchLike } from "./client.js";

export { MonitorResource } from "./resources/monitor.js";
export type {
  EngineParams,
  GoogleParams,
  GoogleNewsParams,
  IncludeOptions,
} from "./resources/monitor.js";

export { AsyncTasksResource } from "./resources/async-tasks.js";
export type {
  AsyncTask,
  CreateTaskParams,
  WaitOptions,
  TaskType,
} from "./resources/async-tasks.js";

export {
  CloroError,
  APIError,
  APIConnectionError,
  APITimeoutError,
  APIStatusError,
  BadRequestError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InternalServerError,
  TaskError,
  TaskFailedError,
  TaskTimeoutError,
} from "./errors.js";

export { VERSION } from "./version.js";
