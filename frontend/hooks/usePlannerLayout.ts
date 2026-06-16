"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/shallow";

import { useClientHydrated } from "@/hooks/useClientHydrated";

import {
  fetchSessionLayout,
  moveSessionPallet,
  moveSessionToFirstFree,
  removeSessionSlot,
  saveSessionLayout,
  type PlannerLayoutState,
} from "@/lib/api/plannerClient";
import {
  getConflictSlotIds,
} from "@/lib/load/capacity";
import type { PalletData } from "@/lib/types/load";
import { useConflicts, useLoadStore } from "@/lib/stores/loadStore";

interface UsePlannerLayoutResult {
  loading: boolean;
  error: string | null;
  vehicle: PlannerLayoutState["vehicle"] | null;
  slots: Record<string, PalletData | null>;
  conflicts: PlannerLayoutState["conflicts"];
  conflictSlotIds: Set<string>;
  sessionId: string | null;
  reload: () => Promise<void>;
  persistSlots: (slots: Record<string, PalletData | null>) => Promise<boolean>;
  movePallet: (
    fromSlot: string,
    toSlot: string,
  ) => Promise<{ ok: boolean; message?: string }>;
  removePallet: (slotId: string) => Promise<void>;
  moveToFirstFree: (
    slotId: string,
  ) => Promise<{ ok: boolean; message?: string }>;
}

export function usePlannerLayout(): UsePlannerLayoutResult {
  const hydrated = useClientHydrated();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { vehicle, slots, sessionId } = useLoadStore(
    useShallow((state) => ({
      vehicle: state.vehicle,
      slots: state.slots,
      sessionId: state.sessionId,
    })),
  );
  const conflicts = useConflicts();

  const hasLayout =
    vehicle !== null || sessionId !== null || Object.keys(slots).length > 0;

  const applyLayout = useCallback((next: PlannerLayoutState) => {
    useLoadStore.getState().setLayout({
      sessionId: next.sessionId ?? useLoadStore.getState().sessionId,
      vehicle: next.vehicle,
      slots: next.slots,
    });
  }, []);

  const reload = useCallback(async () => {
    const activeSessionId = useLoadStore.getState().sessionId;
    setLoading(true);
    setError(null);
    try {
      if (!activeSessionId) {
        // No active session — clear any stale persisted slots so canvas starts empty.
        useLoadStore.getState().clearAllSlots();
        setLoading(false);
        return;
      }
      const next = await fetchSessionLayout(activeSessionId);
      applyLayout(next);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Nie udało się wczytać layoutu.",
      );
    } finally {
      setLoading(false);
    }
  }, [applyLayout]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    const activeSessionId = useLoadStore.getState().sessionId;

    if (activeSessionId) {
      // Always fetch from the server when a session exists — this syncs the
      // vehicle from the session (e.g. after navigating from Fleet Manager).
      queueMicrotask(() => {
        void reload();
      });
      return;
    }

    if (!hasLayout) {
      // No session and no local state — clear stale slots.
      queueMicrotask(() => {
        void reload();
      });
      return;
    }

    setLoading(false);
  }, [hydrated, hasLayout, reload]);

  const persistSlots = useCallback(
    async (nextSlots: Record<string, PalletData | null>) => {
      setError(null);
      try {
        const activeSessionId = useLoadStore.getState().sessionId;
        if (!activeSessionId) {
          // Pre-session: update Zustand locally only
          useLoadStore.getState().setSlots(nextSlots);
          return true;
        }
        const next = await saveSessionLayout(activeSessionId, nextSlots);
        applyLayout(next);
        return true;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Nie udało się zapisać layoutu.",
        );
        return false;
      }
    },
    [applyLayout],
  );

  const movePallet = useCallback(
    async (fromSlot: string, toSlot: string) => {
      setError(null);
      try {
        const activeSessionId = useLoadStore.getState().sessionId;
        if (!activeSessionId) {
          // Pre-session: swap locally in Zustand
          useLoadStore.getState().swapSlots(fromSlot, toSlot);
          return { ok: true };
        }
        const result = await moveSessionPallet(activeSessionId, fromSlot, toSlot);
        applyLayout(result.layout);
        return { ok: result.ok, message: result.message };
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Nie udało się przenieść ładunku.";
        setError(message);
        return { ok: false, message };
      }
    },
    [applyLayout],
  );

  const removePallet = useCallback(
    async (slotId: string) => {
      setError(null);
      try {
        const activeSessionId = useLoadStore.getState().sessionId;
        if (!activeSessionId) {
          // Pre-session: remove locally in Zustand
          useLoadStore.getState().removePallet(slotId);
          return;
        }
        const next = await removeSessionSlot(activeSessionId, slotId);
        applyLayout(next);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Nie udało się usunąć ładunku.",
        );
      }
    },
    [applyLayout],
  );

  const moveToFirstFree = useCallback(
    async (slotId: string) => {
      setError(null);
      try {
        const activeSessionId = useLoadStore.getState().sessionId;
        if (!activeSessionId) {
          // Pre-session: find first empty slot and move locally
          const state = useLoadStore.getState();
          const currentSlots = state.slots;
          const currentVehicle = state.vehicle;
          const pallet = currentSlots[slotId];
          if (!pallet) {
            return { ok: false, message: "Slot jest pusty." };
          }
          // Find first empty slot that isn't the source
          const slotIds = currentVehicle
            ? Object.keys(currentVehicle.payloadSlots)
            : Object.keys(currentSlots);
          const targetSlot = slotIds.find(
            (id) => id !== slotId && currentSlots[id] === null,
          );
          if (!targetSlot) {
            return { ok: false, message: "Brak wolnego slotu." };
          }
          useLoadStore.getState().swapSlots(slotId, targetSlot);
          return { ok: true };
        }
        const result = await moveSessionToFirstFree(activeSessionId, slotId);
        applyLayout(result.layout);
        return { ok: result.ok, message: result.message };
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Nie udało się przenieść do wolnego slotu.";
        setError(message);
        return { ok: false, message };
      }
    },
    [applyLayout],
  );

  const conflictSlotIds = useMemo(
    () => getConflictSlotIds(conflicts),
    [conflicts],
  );

  return {
    loading,
    error,
    vehicle,
    slots,
    conflicts,
    conflictSlotIds,
    sessionId,
    reload,
    persistSlots,
    movePallet,
    removePallet,
    moveToFirstFree,
  };
}
