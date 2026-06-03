"use client";

import { useClientHydrated } from "@/hooks/useClientHydrated";
import { useSessionStore } from "@/lib/stores/sessionStore";

/**
 * sessionId from persisted Zustand — only after client mount.
 * Returns null during SSR/first paint so server HTML matches the client.
 */
export function useHydratedSessionId(): string | null {
  const hydrated = useClientHydrated();
  const sessionId = useSessionStore((state) => state.sessionId);
  return hydrated ? sessionId : null;
}
