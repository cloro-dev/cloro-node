/**
 * Exception hierarchy for the cloro SDK.
 *
 * All errors derive from {@link CloroError}, so a single `catch (err) { if
 * (err instanceof CloroError) ... }` catches everything the SDK can raise. HTTP
 * failures map to {@link APIStatusError} subclasses by status code; the async
 * task poller raises {@link TaskFailedError} / {@link TaskTimeoutError}.
 */

/** Base class for every error raised by the SDK. */
export class CloroError extends Error {
  constructor(message: string) {
    super(message);
    // Subclasses inherit this constructor; `this.constructor.name` resolves to
    // the concrete subclass so stack traces and logs read correctly.
    this.name = this.constructor.name;
  }
}

export interface APIErrorOptions {
  statusCode?: number;
  response?: Response;
  body?: unknown;
}

/** Base class for errors originating from an HTTP request. */
export class APIError extends CloroError {
  readonly statusCode?: number;
  readonly response?: Response;
  readonly body?: unknown;

  constructor(message: string, options: APIErrorOptions = {}) {
    super(message);
    this.statusCode = options.statusCode;
    this.response = options.response;
    this.body = options.body;
  }
}

/** The request could not reach the cloro API (DNS, TLS, socket errors). */
export class APIConnectionError extends APIError {}

/** The request timed out before a response was received. */
export class APITimeoutError extends APIConnectionError {}

/** The API returned a non-2xx status code. */
export class APIStatusError extends APIError {}

/** 400 — the request was malformed or failed validation. */
export class BadRequestError extends APIStatusError {}

/** 401 — the API key is missing or invalid. */
export class AuthenticationError extends APIStatusError {}

/** 403 — the API key is not allowed to perform this action. */
export class PermissionDeniedError extends APIStatusError {}

/** 404 — the requested resource does not exist. */
export class NotFoundError extends APIStatusError {}

/** 409 — the request conflicts with current state (e.g. concurrency limit). */
export class ConflictError extends APIStatusError {}

/** 429 — too many requests; retry after backing off. */
export class RateLimitError extends APIStatusError {}

/** 5xx — the API failed to process the request. */
export class InternalServerError extends APIStatusError {}

/** Base class for async task queue errors. */
export class TaskError extends CloroError {}

/** An async task reached the `FAILED` terminal status while polling. */
export class TaskFailedError extends TaskError {
  readonly task?: unknown;
  readonly response?: Record<string, unknown>;

  constructor(
    message: string,
    options: { task?: unknown; response?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.task = options.task;
    this.response = options.response;
  }
}

/** An async task did not reach a terminal status within the poll timeout. */
export class TaskTimeoutError extends TaskError {
  readonly task?: unknown;

  constructor(message: string, options: { task?: unknown } = {}) {
    super(message);
    this.task = options.task;
  }
}
