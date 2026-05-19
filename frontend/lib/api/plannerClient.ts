import type { LoadLayoutResponse, PalletData, SlotConflict, VehicleConfig } from "@/lib/types/load";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export interface PlannerLayoutState {
  sessionId: string | null;
  vehicle: VehicleConfig;
  slots: Record<string, PalletData | null>;
  conflicts: SlotConflict[];
}

function normalizeLayout(payload: LoadLayoutResponse): PlannerLayoutState {
  return {
    sessionId: payload.sessionId,
    vehicle: payload.vehicle,
    slots: payload.slots,
    conflicts: payload.conflicts,
  };
}

export async function fetchDemoLayout(): Promise<PlannerLayoutState> {
  const response = await fetch(`${API_BASE}/api/v1/planner/demo`);
  if (!response.ok) {
    throw new Error(`Failed to load demo layout (${response.status})`);
  }
  return normalizeLayout(await response.json());
}

export async function saveDemoLayout(
  slots: Record<string, PalletData | null>,
): Promise<PlannerLayoutState> {
  const response = await fetch(`${API_BASE}/api/v1/planner/demo`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slots }),
  });
  if (!response.ok) {
    throw new Error(`Failed to save demo layout (${response.status})`);
  }
  return normalizeLayout(await response.json());
}

export async function moveDemoPallet(
  fromSlot: string,
  toSlot: string,
): Promise<{ ok: boolean; layout: PlannerLayoutState; message?: string }> {
  const params = new URLSearchParams({ fromSlot, toSlot });
  const response = await fetch(`${API_BASE}/api/v1/planner/demo/move?${params}`, {
    method: "POST",
  });
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

export async function removeDemoSlot(slotId: string): Promise<PlannerLayoutState> {
  const response = await fetch(`${API_BASE}/api/v1/planner/demo/slots/${slotId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`Failed to remove slot (${response.status})`);
  }
  return normalizeLayout(await response.json());
}

export async function moveDemoToFirstFree(
  slotId: string,
): Promise<{ ok: boolean; layout: PlannerLayoutState; message?: string }> {
  const response = await fetch(
    `${API_BASE}/api/v1/planner/demo/slots/${slotId}/move-to-first-free`,
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
