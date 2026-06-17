import { fetchWithRetry, type FetchWithRetryOptions } from "@/lib/api/fetchWithRetry";
import { normalizePalletDims, normalizePayloadSlots } from "@/lib/load/capacity";
import type { LoadLayoutResponse, PalletData, SlotConflict, VehicleConfig } from "@/lib/types/load";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export interface PlannerLayoutState {
  sessionId: string | null;
  vehicle: VehicleConfig;
  slots: Record<string, PalletData | null>;
  conflicts: SlotConflict[];
}

function normalizeSlots(
  slots: Record<string, PalletData | null>,
): Record<string, PalletData | null> {
  return Object.fromEntries(
    Object.entries(slots).map(([slotId, pallet]) => [
      slotId,
      pallet ? normalizePalletDims(pallet) : null,
    ]),
  );
}

function normalizeLayout(payload: LoadLayoutResponse): PlannerLayoutState {
  return {
    sessionId: payload.sessionId,
    vehicle: {
      ...payload.vehicle,
      payloadSlots: normalizePayloadSlots(payload.vehicle.payloadSlots),
    },
    slots: normalizeSlots(payload.slots),
    conflicts: payload.conflicts,
  };
}

// ─── Session-scoped layout API ───────────────────────────────────────────────

/**
 * Load the session layout. This is a GET (idempotent), so it uses
 * {@link fetchWithRetry} with exponential backoff (1s, 2s, 4s) so a short
 * backend hiccup recovers without forcing the user to refresh (UX-05).
 *
 * The mutating layout endpoints below intentionally use plain `fetch` — a
 * POST/PUT/DELETE must never be silently replayed.
 */
export async function fetchSessionLayout(
  sessionId: string,
  options?: { onRetry?: FetchWithRetryOptions["onRetry"]; signal?: AbortSignal },
): Promise<PlannerLayoutState> {
  const response = await fetchWithRetry(
    `${API_BASE}/api/v1/planner/sessions/${sessionId}/layout`,
    { onRetry: options?.onRetry, signal: options?.signal },
  );
  if (!response.ok) {
    throw new Error(`Failed to load session layout (${response.status})`);
  }
  return normalizeLayout(await response.json());
}

export async function saveSessionLayout(
  sessionId: string,
  slots: Record<string, PalletData | null>,
): Promise<PlannerLayoutState> {
  const response = await fetch(`${API_BASE}/api/v1/planner/sessions/${sessionId}/layout`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slots }),
  });
  if (!response.ok) {
    throw new Error(`Failed to save session layout (${response.status})`);
  }
  return normalizeLayout(await response.json());
}

export async function moveSessionPallet(
  sessionId: string,
  fromSlot: string,
  toSlot: string,
): Promise<{ ok: boolean; layout: PlannerLayoutState; message?: string }> {
  const params = new URLSearchParams({ fromSlot, toSlot });
  const response = await fetch(
    `${API_BASE}/api/v1/planner/sessions/${sessionId}/layout/move?${params}`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new Error(`Failed to move pallet (${response.status})`);
  }
  const body = await response.json();
  return {
    ok: body.ok,
    message: body.message,
    layout: normalizeLayout(body.layout),
  };
}

export async function removeSessionSlot(
  sessionId: string,
  slotId: string,
): Promise<PlannerLayoutState> {
  const response = await fetch(
    `${API_BASE}/api/v1/planner/sessions/${sessionId}/layout/slots/${slotId}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error(`Failed to remove slot (${response.status})`);
  }
  return normalizeLayout(await response.json());
}

export async function moveSessionToFirstFree(
  sessionId: string,
  slotId: string,
): Promise<{ ok: boolean; layout: PlannerLayoutState; message?: string }> {
  const response = await fetch(
    `${API_BASE}/api/v1/planner/sessions/${sessionId}/layout/slots/${slotId}/move-to-first-free`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new Error(`Failed to move to first free slot (${response.status})`);
  }
  const body = await response.json();
  return {
    ok: body.ok,
    message: body.message,
    layout: normalizeLayout(body.layout),
  };
}
