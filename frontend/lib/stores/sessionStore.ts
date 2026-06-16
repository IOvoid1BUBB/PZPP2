"use client";

import { create } from "zustand";
import { useLoadStore } from "@/lib/stores/loadStore";

// ─── Interface ──────────────────────────────────────────────────────────────

export interface SessionStore {
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
  status: string;
  setStatus: (status: string) => void;
  isReadOnly: boolean;
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessionId: useLoadStore.getState().sessionId,
  setSessionId: (id) => {
    useLoadStore.getState().setSessionId(id);
    set({ sessionId: id });
  },
  status: "draft",
  setStatus: (status) => set({ status }),
  isReadOnly: false,
}));

useLoadStore.subscribe((state, previousState) => {
  if (state.sessionId !== previousState.sessionId) {
    useSessionStore.setState({ sessionId: state.sessionId, status: "draft", isReadOnly: false });
  }
});
