/**
 * Async task queue — enqueue work, then poll to completion.
 *
 * This is where the SDK earns its keep over raw `fetch`: {@link
 * AsyncTasksResource.wait} polls `GET /v1/async/task/{id}` with interval
 * backoff and a timeout, and {@link AsyncTasksResource.run} collapses
 * create-then-wait into a single call.
 */
import type { Cloro } from "../client.js";
import { TaskFailedError, TaskTimeoutError } from "../errors.js";

/** Provider identifiers accepted by the `taskType` field. */
export type TaskType =
  | "CHATGPT"
  | "GEMINI"
  | "PERPLEXITY"
  | "COPILOT"
  | "GROK"
  | "AIMODE"
  | "GOOGLE"
  | "GOOGLE_NEWS";

/** A handle to a queued task. Returned by {@link AsyncTasksResource.create}. */
export interface AsyncTask {
  id: string;
  status: string;
  taskType?: string;
  priority?: number;
  createdAt?: string;
  /** The raw task summary object returned by the API. */
  raw: Record<string, unknown>;
}

export interface CreateTaskParams {
  /** One of CHATGPT, GEMINI, PERPLEXITY, COPILOT, GROK, AIMODE, GOOGLE, GOOGLE_NEWS. */
  taskType: TaskType | string;
  /** Provider-specific body, e.g. `{ prompt, country }` or `{ query, country }`. */
  payload: Record<string, unknown>;
  /** 1-10, higher runs first (default 1). */
  priority?: number;
  /** Unique string to dedupe task creation. */
  idempotencyKey?: string;
  /** `{ url }` to be notified on completion. */
  webhook?: Record<string, unknown>;
}

export interface WaitOptions {
  /** Milliseconds before the first poll; grows by `backoff` (default 2000). */
  pollInterval?: number;
  /** Give up after this many milliseconds (default 300000). */
  timeout?: number;
  /** Multiplier applied to the interval after each poll (default 1.5). */
  backoff?: number;
  /** Ceiling for the polling interval in milliseconds (default 15000). */
  maxInterval?: number;
}

function taskId(task: AsyncTask | string): string {
  return typeof task === "string" ? task : task.id;
}

function taskFromSummary(summary: Record<string, any>): AsyncTask {
  return {
    id: summary.id,
    status: summary.status ?? "QUEUED",
    taskType: summary.taskType,
    priority: summary.priority,
    createdAt: summary.createdAt,
    raw: summary,
  };
}

/** Normalize a CreateTaskParams into the API's request shape. */
function toRequest(params: CreateTaskParams): Record<string, unknown> {
  const out: Record<string, unknown> = {
    taskType: params.taskType,
    payload: params.payload,
  };
  if (params.priority !== undefined) out.priority = params.priority;
  if (params.idempotencyKey !== undefined) out.idempotencyKey = params.idempotencyKey;
  if (params.webhook !== undefined) out.webhook = params.webhook;
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The `/v1/async/*` task queue. */
export class AsyncTasksResource {
  constructor(private readonly client: Cloro) {}

  // -- create ---------------------------------------------------------

  /** Enqueue a single task. `POST /v1/async/task`. */
  async create(params: CreateTaskParams): Promise<AsyncTask> {
    const resp = await this.client.request({
      method: "POST",
      path: "/v1/async/task",
      body: toRequest(params),
    });
    return taskFromSummary(resp.task);
  }

  /**
   * Enqueue up to 500 tasks in one call. `POST /v1/async/task/batch`.
   *
   * Returns the per-task `results` array, preserving input order. Successful
   * items carry a `task` field; failed items carry an `error` field.
   */
  async createBatch(tasks: CreateTaskParams[]): Promise<Array<Record<string, any>>> {
    const body = tasks.map(toRequest);
    const resp = await this.client.request({
      method: "POST",
      path: "/v1/async/task/batch",
      body,
    });
    return resp.results ?? [];
  }

  // -- read -----------------------------------------------------------

  /**
   * Fetch a task's current status. `GET /v1/async/task/{id}`.
   *
   * The `response` field is present only once the task is `COMPLETED` or
   * `FAILED`.
   */
  retrieve(task: AsyncTask | string): Promise<Record<string, any>> {
    return this.client.request({ method: "GET", path: `/v1/async/task/${taskId(task)}` });
  }

  /** Queue-wide status for your organization. `GET /v1/async/status`. */
  status(): Promise<Record<string, any>> {
    return this.client.request({ method: "GET", path: "/v1/async/status" });
  }

  // -- poll -----------------------------------------------------------

  /**
   * Poll a task until it reaches a terminal status, then resolve with it.
   *
   * @throws {TaskFailedError} the task reached `FAILED`.
   * @throws {TaskTimeoutError} the task did not finish within `timeout`.
   */
  async wait(task: AsyncTask | string, options: WaitOptions = {}): Promise<Record<string, any>> {
    const pollInterval = options.pollInterval ?? 2000;
    const timeout = options.timeout ?? 300_000;
    const backoff = options.backoff ?? 1.5;
    const maxInterval = options.maxInterval ?? 15_000;

    const deadline = Date.now() + timeout;
    let interval = pollInterval;
    for (;;) {
      const status = await this.retrieve(task);
      const state = status?.task?.status;
      if (state === "COMPLETED") return status;
      if (state === "FAILED") {
        throw new TaskFailedError(`Task ${taskId(task)} failed`, { task, response: status });
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new TaskTimeoutError(
          `Task ${taskId(task)} did not complete within ${timeout}ms (last status: ${state})`,
          { task },
        );
      }
      await sleep(Math.min(interval, remaining));
      interval = Math.min(interval * backoff, maxInterval);
    }
  }

  /**
   * Create a task and resolve once it completes. Convenience for
   * {@link create} + {@link wait}.
   */
  async run(params: CreateTaskParams & WaitOptions): Promise<Record<string, any>> {
    const { pollInterval, timeout, backoff, maxInterval, ...create } = params;
    const task = await this.create(create as CreateTaskParams);
    return this.wait(task, { pollInterval, timeout, backoff, maxInterval });
  }
}
