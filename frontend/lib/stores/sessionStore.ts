/**
 * @file sessionStore.ts
 * @task Task 1.5 — useSessionStore (Zustand)
 *
 * TODO: Zaimplementuj store używając Zustand `create()`.
 *
 * Wymagane API:
 *   sessionId    : string | null
 *   setSessionId : (id: string) => void
 *
 * Przykładowa implementacja Zustand:
 *
 *   import { create } from "zustand";
 *   export const useSessionStore = create<SessionStore>((set) => ({
 *     sessionId: null,
 *     setSessionId: (id) => set({ sessionId: id }),
 *   }));
 *
 * Opcjonalnie dodaj middleware devtools:
 *   import { devtools } from "zustand/middleware";
 *   create<SessionStore>()(devtools(..., { name: "sessionStore" }))
 */

// ─── Interface ──────────────────────────────────────────────────────────────

export interface SessionStore {
  /** ID aktywnej sesji konsolidacji (null = brak sesji) */
  sessionId: string | null;
  /** Zapisz ID sesji zwrócone przez POST /api/v1/sessions */
  setSessionId: (id: string) => void;
}

// ─── Stub hook ──────────────────────────────────────────────────────────────
// Tymczasowy stub — nie modyfikuj sygnatury. Zastąp implementacją Zustand.

let _sessionId: string | null = null;

/** @todo Zastąp implementacją Zustand create<SessionStore>() */
export function useSessionStore(): SessionStore {
  return {
    sessionId: _sessionId,
    setSessionId: (id) => {
      _sessionId = id;
    },
  };
}
