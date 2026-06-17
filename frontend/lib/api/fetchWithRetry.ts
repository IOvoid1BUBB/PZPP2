/**
 * @file fetchWithRetry.ts
 *
 * `fetch` wrapper with exponential backoff for transient failures (UX-05).
 *
 * Retries on:
 *   - network errors (fetch rejects: DNS, connection refused, timeout)
 *   - HTTP 5xx
 *   - HTTP 408 (Request Timeout) and 429 (Too Many Requests)
 *
 * Does NOT retry other 4xx (they are deterministic client errors).
 *
 * IMPORTANT: only use for idempotent requests (GET/HEAD). Non-idempotent
 * verbs (POST/PUT/PATCH/DELETE) must call `fetch` directly so a request is
 * never silently replayed.
 */

import { NetworkError } from "@/lib/api/errors";

/** Details surfaced to {@link FetchWithRetryOptions.onRetry} before each retry. */
export interface RetryInfo {
  /** 1-based number of the upcoming retry attempt. */
  attempt: number;
  /** Backoff delay (ms) before the upcoming attempt. */
  delayMs: number;
  /** HTTP status that triggered the retry (when the response was reachable). */
  status?: number;
  /** Error that triggered the retry (network failures / timeouts). */
  error?: unknown;
}

export interface FetchWithRetryOptions extends RequestInit {
  /** Max number of *retries* after the initial attempt (default 3). */
  maxRetries?: number;
  /** Base backoff in ms; attempt N waits baseDelayMs * 2^N (default 1000). */
  baseDelayMs?: number;
  /** Per-attempt timeout in ms (default 15000). */
  timeoutMs?: number;
  /**
   * Invoked right before each backoff sleep (i.e. once per retry that will
   * actually happen). Use to surface a "retrying…" hint. Never called on the
   * final, non-retried attempt.
   */
  onRetry?: (info: RetryInfo) => void;
}

const RETRYABLE_STATUS = new Set([408, 429]);

function isRetryableStatus(status: number): boolean {
  return status >= 500 || RETRYABLE_STATUS.has(status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Combine an external AbortSignal with a per-request timeout signal.
 * Falls back gracefully when `AbortSignal.any` is unavailable.
 */
function withTimeout(
  external: AbortSignal | null | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cancel: () => void } {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const cancel = () => clearTimeout(timer);

  if (external) {
    const anyFn = (
      AbortSignal as unknown as {
        any?: (signals: AbortSignal[]) => AbortSignal;
      }
    ).any;
    if (typeof anyFn === "function") {
      return { signal: anyFn([external, timeoutController.signal]), cancel };
    }
    // Fallback: forward external aborts to the timeout controller.
    if (external.aborted) {
      timeoutController.abort();
    } else {
      external.addEventListener("abort", () => timeoutController.abort(), {
        once: true,
      });
    }
  }

  return { signal: timeoutController.signal, cancel };
}

export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    timeoutMs = 15000,
    onRetry,
    signal: externalSignal,
    ...init
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const { signal, cancel } = withTimeout(externalSignal, timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal });
      cancel();

      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        const delayMs = baseDelayMs * 2 ** attempt;
        onRetry?.({ attempt: attempt + 1, delayMs, status: response.status });
        await sleep(delayMs);
        continue;
      }
      return response;
    } catch (err) {
      cancel();

      // Caller-initiated abort: surface immediately, never retry.
      if (
        externalSignal?.aborted ||
        (err instanceof DOMException && err.name === "AbortError" && externalSignal)
      ) {
        throw err;
      }

      lastError = err;
      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * 2 ** attempt;
        onRetry?.({ attempt: attempt + 1, delayMs, error: err });
        await sleep(delayMs);
        continue;
      }
    }
  }

  throw new NetworkError(
    "Brak połączenia z serwerem po kilku próbach.",
    lastError,
  );
}
