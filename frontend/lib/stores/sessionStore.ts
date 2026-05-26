"use client";

import { create } from "zustand";
import { useLoadStore } from "@/lib/stores/loadStore";

// ─── Interface ──────────────────────────────────────────────────────────────

export interface SessionStore {
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessionId: useLoadStore.getState().sessionId,
  setSessionId: (id) => {
    useLoadStore.getState().setSessionId(id);
    set({ sessionId: id });
  },
}));

useLoadStore.subscribe((state, previousState) => {
  if (state.sessionId !== previousState.sessionId) {
    useSessionStore.setState({ sessionId: state.sessionId });
  }
});
