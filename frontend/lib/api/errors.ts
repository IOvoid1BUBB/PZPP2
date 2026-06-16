/**
 * @file errors.ts
 *
 * Typed error hierarchy for the frontend API layer (TECH-04).
 *
 * Components can branch on error type instead of parsing strings:
 *
 *   try {
 *     await updateSessionStatus(id, "confirmed");
 *   } catch (e) {
 *     if (e instanceof ConflictError) showToast(e.detail);
 *   }
 */

/** Shape of the JSON error body returned by the FastAPI backend. */
export interface ApiErrorBody {
  error?: string;
  detail?: string;
  request_id?: string;
  [key: string]: unknown;
}

/**
 * Base class for every error thrown by the API clients.
 * Carries the HTTP status, a machine-readable `code` and a human `detail`.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly body?: ApiErrorBody;

  constructor(
    status: number,
    code: string,
    detail: string,
    body?: ApiErrorBody,
  ) {
    super(detail || code || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.body = body;
  }
}

/** Network failure / request never reached the server (DNS, refused, timeout). */
export class NetworkError extends ApiError {
  constructor(detail = "Brak połączenia z serwerem.", cause?: unknown) {
    super(0, "network_error", detail);
    this.name = "NetworkError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/** 422 — request body failed validation. */
export class ValidationError extends ApiError {
  constructor(detail: string, body?: ApiErrorBody) {
    super(422, body?.error ?? "validation_error", detail, body);
    this.name = "ValidationError";
  }
}

/** 404 — resource not found. */
export class NotFoundError extends ApiError {
  constructor(detail: string, body?: ApiErrorBody) {
    super(404, body?.error ?? "not_found", detail, body);
    this.name = "NotFoundError";
  }
}

/** 409 — conflicting state (e.g. insufficient capacity, illegal transition). */
export class ConflictError extends ApiError {
  constructor(detail: string, body?: ApiErrorBody) {
    super(409, body?.error ?? "conflict", detail, body);
    this.name = "ConflictError";
  }
}

/**
 * Build the right {@link ApiError} subclass from a non-OK `Response`.
 *
 * Reads the JSON body once (best-effort) and maps the status code to a
 * specific subclass so callers can use `instanceof` checks.
 */
export async function errorFromResponse(
  response: Response,
  fallbackMessage?: string,
): Promise<ApiError> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
  const detail =
    body.detail ??
    body.error ??
    fallbackMessage ??
    `Żądanie nie powiodło się (${response.status})`;

  switch (response.status) {
    case 404:
      return new NotFoundError(detail, body);
    case 409:
      return new ConflictError(detail, body);
    case 422:
      return new ValidationError(detail, body);
    default:
      return new ApiError(
        response.status,
        body.error ?? "http_error",
        detail,
        body,
      );
  }
}
