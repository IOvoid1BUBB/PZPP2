"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/shallow";

import { useClientHydrated } from "@/hooks/useClientHydrated";

import {
  fetchSessionLayout,
  moveDemoPallet,
  moveDemoToFirstFree,
  moveSessionPallet,
  moveSessionToFirstFree,
  removeDemoSlot,
  removeSessionSlot,
  resetDemoLayout,
  saveDemoLayout,
  saveSessionLayout,
  type PlannerLayoutState,
} from "@/lib/api/plannerClient";
import {
  getConflictSlotIds,
  payloadSlotsGeometryStale,
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
  loadDemoFor: (vehicleType: string) => Promise<void>;
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
    vehicle !== null || Object.keys(slots).length > 0;

  const needsSessionHydration = sessionId !== null && vehicle === null;

  const applyLayout = useCallback((next: PlannerLayoutState) => {
    useLoadStore.getState().setLayout({
      sessionId: next.sessionId ?? useLoadStore.getState().sessionId,
      vehicle: next.vehicle,
      slots: next.slots,
    });
  }, []);

  const hasStoreLayout = useCallback(() => {
    const state = useLoadStore.getState();
    return (
      state.vehicle !== null ||
      state.sessionId !== null ||
      Object.keys(state.slots).length > 0
    );
  }, []);

  const reload = useCallback(async () => {
    const activeSessionId = useLoadStore.getState().sessionId;
    const hadLayoutBeforeFetch = hasStoreLayout();
    setLoading(true);
    setError(null);
    try {
      if (!activeSessionId) {
        // Brak aktywnej sesji — nie ładujemy demo, czekamy aż użytkownik wybierze pojazd.
        setLoading(false);
        return;
      }
      const next = await fetchSessionLayout(activeSessionId);
      if (!hadLayoutBeforeFetch && hasStoreLayout()) {
        return;
      }

      applyLayout(next);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Nie udało się wczytać layoutu.",
      );
    } finally {
      setLoading(false);
    }
  }, [applyLayout, hasStoreLayout]);

  const loadDemoFor = useCallback(
    async (vehicleType: string) => {
      setLoading(true);
      setError(null);
      try {
        const activeSessionId = useLoadStore.getState().sessionId;
        if (activeSessionId) {
          const next = await fetchSessionLayout(activeSessionId);
          applyLayout(next);
          return;
        }
        // Brak sesji — użyj demo endpointa (akceptowalne w flow wyboru pojazdu bez sesji)
        const next = await resetDemoLayout(vehicleType);
        applyLayout(next);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Nie udało się wczytać layoutu pojazdu.",
        );
      } finally {
        setLoading(false);
      }
    },
    [applyLayout],
  );

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    if (needsSessionHydration || !hasLayout) {
      queueMicrotask(() => {
        void reload();
      });
      return;
    }

    setLoading(false);

    if (!payloadSlotsGeometryStale(vehicle)) {
      return;
    }

    void (async () => {
      try {
        const activeSessionId = useLoadStore.getState().sessionId;
        if (!activeSessionId) {
          return;
        }
        const next = await fetchSessionLayout(activeSessionId);
        const current = useLoadStore.getState();
        if (!current.vehicle) {
          return;
        }

        useLoadStore.getState().setLayout({
          sessionId: current.sessionId,
          vehicle: {
            ...current.vehicle,
            payloadSlots: next.vehicle.payloadSlots,
          },
          slots: current.slots,
        });
      } catch {
        /* keep existing layout if refresh fails */
      }
    })();
  }, [applyLayout, hasLayout, hydrated, needsSessionHydration, reload, vehicle]);

  const currentVehicleType = useCallback(
    () => useLoadStore.getState().vehicle?.type ?? null,
    [],
  );

  const persistSlots = useCallback(
    async (nextSlots: Record<string, PalletData | null>) => {
      setError(null);
      try {
        const activeSessionId = useLoadStore.getState().sessionId;
        const next = activeSessionId
          ? await saveSessionLayout(activeSessionId, nextSlots)
          : await saveDemoLayout(nextSlots, currentVehicleType());
        applyLayout(next);
        return true;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Nie udało się zapisać layoutu.",
        );
        return false;
      }
    },
    [applyLayout, currentVehicleType],
  );

  const movePallet = useCallback(
    async (fromSlot: string, toSlot: string) => {
      setError(null);
      try {
        const activeSessionId = useLoadStore.getState().sessionId;
        const result = activeSessionId
          ? await moveSessionPallet(activeSessionId, fromSlot, toSlot)
          : await moveDemoPallet(fromSlot, toSlot, currentVehicleType());
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
    [applyLayout, currentVehicleType],
  );

  const removePallet = useCallback(
    async (slotId: string) => {
      setError(null);
      try {
        const activeSessionId = useLoadStore.getState().sessionId;
        const next = activeSessionId
          ? await removeSessionSlot(activeSessionId, slotId)
          : await removeDemoSlot(slotId, currentVehicleType());
        applyLayout(next);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Nie udało się usunąć ładunku.",
        );
      }
    },
    [applyLayout, currentVehicleType],
  );

  const moveToFirstFree = useCallback(
    async (slotId: string) => {
      setError(null);
      try {
        const activeSessionId = useLoadStore.getState().sessionId;
        const result = activeSessionId
          ? await moveSessionToFirstFree(activeSessionId, slotId)
          : await moveDemoToFirstFree(slotId, currentVehicleType());
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
    [applyLayout, currentVehicleType],
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
    loadDemoFor,
    persistSlots,
    movePallet,
    removePallet,
    moveToFirstFree,
  };
}
