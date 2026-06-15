"use client";

import dynamic from "next/dynamic";

const RouteMapClient = dynamic(() => import("@/components/map/RouteMapClient"), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-[420px] place-items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-raised)]">
      <p className="text-sm text-[var(--ui-text-secondary)]">Ładowanie mapy…</p>
    </div>
  ),
});

export interface RouteMapLazyProps {
  sessionId: string;
}

export function RouteMapLazy({ sessionId }: RouteMapLazyProps) {
  return <RouteMapClient sessionId={sessionId} />;
}
