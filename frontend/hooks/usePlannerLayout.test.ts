/**
 * usePlannerLayout.test.ts
 *
 * UX-05: a short backend outage must recover without a manual refresh.
 * The reload path goes through fetchWithRetry (exponential backoff) and surfaces
 * a single "retrying…" info toast per reload cycle.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const showToast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ showToast }),
}));

import { usePlannerLayout } from "./usePlannerLayout";
import { useLoadStore } from "@/lib/stores/loadStore";

const SESSION_ID = "session-recover-1";

function layoutResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        sessionId: SESSION_ID,
        vehicle: {
          id: "veh-1",
          name: "Test Van",
          maxLdm: 10,
          maxWeightKg: 1000,
          payloadSlots: {},
        },
        slots: {},
        conflicts: [],
      }),
  } as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
  showToast.mockClear();
  useLoadStore.getState().clearAllSlots();
  useLoadStore.getState().setSessionId(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("usePlannerLayout — retry sieci (9.5)", () => {
  it("odzyskuje layout po krótkiej awarii API i pokazuje jeden toast retry", async () => {
    useLoadStore.getState().setSessionId(SESSION_ID);

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(layoutResponse());
    vi.stubGlobal("fetch", fetchMock);

    const hook = renderHook(() => usePlannerLayout());

    // Flush hydration effect + queued reload + backoff sleep + retry success.
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "info",
        message: expect.stringContaining("ponowienie za"),
      }),
    );
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.sessionId).toBe(SESSION_ID);
    expect(hook.result.current.vehicle).not.toBeNull();
  });

  it("ładuje layout od razu gdy API działa (bez toasta retry)", async () => {
    useLoadStore.getState().setSessionId(SESSION_ID);

    const fetchMock = vi.fn().mockResolvedValue(layoutResponse());
    vi.stubGlobal("fetch", fetchMock);

    const hook = renderHook(() => usePlannerLayout());

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(showToast).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.vehicle).not.toBeNull();
  });
});
