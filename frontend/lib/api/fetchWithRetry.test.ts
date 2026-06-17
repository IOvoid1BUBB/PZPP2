/**
 * fetchWithRetry.test.ts
 *
 * UX-05: exponential-backoff retry wrapper for idempotent requests.
 * Covers: retry on 5xx / network errors, retry on 408 & 429, NO retry on
 * deterministic 4xx (409 / 422), backoff timing (1s, 2s, 4s) and the onRetry hook.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchWithRetry } from "./fetchWithRetry";
import { NetworkError } from "./errors";

function makeResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve({}),
  } as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchWithRetry", () => {
  it("ponawia przy 503 i zwraca sukces po odzyskaniu", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchWithRetry("/api/x");
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ponawia przy błędzie sieci i zwraca sukces", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(makeResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchWithRetry("/api/x");
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([409, 422])("NIE ponawia przy %s (deterministyczny 4xx)", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(status));
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchWithRetry("/api/x");

    expect(res.status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([408, 429])("ponawia przy %s", async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(status))
      .mockResolvedValueOnce(makeResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchWithRetry("/api/x");
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stosuje exponential backoff 1s, 2s, 4s i woła onRetry przy każdej próbie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(503));
    vi.stubGlobal("fetch", fetchMock);
    const onRetry = vi.fn();

    const promise = fetchWithRetry("/api/x", { onRetry });
    await vi.runAllTimersAsync();
    const res = await promise;

    // 503 cały czas → 1 początkowa próba + 3 ponowienia, potem zwraca 503.
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(onRetry.mock.calls.map((call) => call[0].delayMs)).toEqual([
      1000, 2000, 4000,
    ]);
    expect(onRetry.mock.calls.map((call) => call[0].attempt)).toEqual([1, 2, 3]);
  });

  it("rzuca NetworkError po wyczerpaniu prób przy stałym błędzie sieci", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const settled = fetchWithRetry("/api/x", { maxRetries: 2 }).catch((e) => e);
    await vi.runAllTimersAsync();
    const result = await settled;

    expect(result).toBeInstanceOf(NetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("respektuje maxRetries=0 (brak ponowień)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(503));
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchWithRetry("/api/x", { maxRetries: 0 });

    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
