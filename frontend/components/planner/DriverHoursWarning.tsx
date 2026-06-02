"use client";

import useSWR from "swr";

import { useSessionStore } from "@/lib/stores/sessionStore";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

interface DriverComplianceResponse {
  compliant: boolean;
  violations: string[];
  total_days: number;
  recommended_overnight_stops: number[];
}

const fetcher = async (url: string): Promise<DriverComplianceResponse> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Nie udało się pobrać walidacji czasu pracy (${response.status}).`);
  }
  return (await response.json()) as DriverComplianceResponse;
};

export function DriverHoursWarning() {
  const sessionId = useSessionStore((state) => state.sessionId);
  const endpoint = sessionId ? `${API_BASE}/api/v1/sessions/${sessionId}/driver-compliance` : null;
  const { data } = useSWR(endpoint, fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 30_000,
  });

  if (!sessionId || !data || data.compliant) {
    return null;
  }

  const isSevere = data.violations.length > 1;
  const containerClass = isSevere
    ? "border-red-300 bg-red-50 text-red-950 dark:border-red-400/80 dark:bg-red-950/70 dark:text-red-50"
    : "border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-300/80 dark:bg-amber-900/70 dark:text-amber-50";
  const badgeClass = isSevere
    ? "bg-red-900/10 text-red-900 dark:bg-red-100/25 dark:text-red-50"
    : "bg-amber-900/10 text-amber-900 dark:bg-amber-100/25 dark:text-amber-50";

  return (
    <section
      className={`rounded-lg border px-4 py-3 shadow-sm ${containerClass}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold tracking-tight">
            Trasa narusza limity czasu pracy kierowcy (EU 561/2006).
          </p>
          <p className="text-sm">
            Zaplanowano {data.total_days} dni. Rozważ podział trasy i nocleg po zdarzeniu{" "}
            {data.recommended_overnight_stops[0] ?? "N/A"}.
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClass}`}>
          Naruszeń: {data.violations.length}
        </span>
      </div>

      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {data.violations.map((violation) => (
          <li key={violation}>{violation}</li>
        ))}
      </ul>
    </section>
  );
}
