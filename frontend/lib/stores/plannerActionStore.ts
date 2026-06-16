"use client";

import { create } from "zustand";

/**
 * Most między stroną plannera a przyciskiem "Send to driver" w nagłówku AppShell.
 * Planner rejestruje handler + stan dostępności; AppShell renderuje przycisk.
 */
export interface PlannerActionStore {
  canSend: boolean;
  busy: boolean;
  handler: (() => void) | null;
  register: (handler: (() => void) | null, canSend: boolean) => void;
  setBusy: (busy: boolean) => void;
  reset: () => void;
}

export const usePlannerActionStore = create<PlannerActionStore>((set) => ({
  canSend: false,
  busy: false,
  handler: null,
  register: (handler, canSend) => set({ handler, canSend }),
  setBusy: (busy) => set({ busy }),
  reset: () => set({ handler: null, canSend: false, busy: false }),
}));
