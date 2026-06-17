"use client";

import useSWR from "swr";

import { useSessionStore } from "@/lib/stores/sessionStore";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

// Conservative weekly driving budget (EU 561/2006 art. 6(2)).
const WEEKLY_LIMIT_HOURS = 54.5;

interface DriverComplianceApiResponse {
  compliant: boolean;
  violations: string[];
  total_days: number;
  recommended_overnight_stops: number[];
  total_driving_hours: number;
  weekly_driving_hours: number;
  hours_used_this_week: number | null;
  hours_remaining_this_week: number | null;
}

const fetcher = async (url: string): Promise<DriverComplianceApiResponse> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch driver compliance (${response.status}).`);
  }
  return (await response.json()) as DriverComplianceApiResponse;
};

function weeklyBarColor(hours: number): string {
  if (hours < 40) {
    return "bg-green-500";
  }
  if (hours <= 50) {
    return "bg-amber-400";
  }
  return "bg-red-500";
}

export function DriverHoursWarning() {
  const sessionId = useSessionStore((state) => state.sessionId);
  const endpoint = sessionId ? `${API_BASE}/api/v1/sessions/${sessionId}/driver-compliance` : null;
  const { data } = useSWR(endpoint, fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 30_000,
  });

  if (!sessionId || !data) {
    return null;
  }

  const weeklyDrivingHours = data.weekly_driving_hours ?? 0;
  const weeklyLimitHours = WEEKLY_LIMIT_HOURS;
  const weeklyPct = Math.min(
    100,
    weeklyLimitHours > 0 ? (weeklyDrivingHours / weeklyLimitHours) * 100 : 0,
  );
  const approachingLimit =
    data.compliant && weeklyDrivingHours > weeklyLimitHours - 4;

  const isSevere = data.violations.length > 1;
  const violationContainerClass = isSevere
    ? "border-red-300 bg-red-50 text-red-950 dark:border-red-400/80 dark:bg-red-950/70 dark:text-red-50"
    : "border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-300/80 dark:bg-amber-900/70 dark:text-amber-50";
  const badgeClass = isSevere
    ? "bg-red-900/10 text-red-900 dark:bg-red-100/25 dark:text-red-50"
    : "bg-amber-900/10 text-amber-900 dark:bg-amber-100/25 dark:text-amber-50";

  return (
    <div className="space-y-3">
      {!data.compliant && (
        <section
          className={`rounded-lg border px-4 py-3 shadow-sm ${violationContainerClass}`}
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
      )}

      <section className="rounded-lg border border-[var(--ui-border)] px-4 py-3 shadow-sm">
        <p className="text-sm font-semibold tracking-tight text-[var(--ui-text-primary)]">
          Limit tygodniowy
        </p>
        <p className="mt-0.5 text-xs text-[var(--ui-text-secondary)]">
          Czas jazdy w tygodniu
        </p>
        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[var(--ui-border)]">
          <div
            className={`h-full rounded-full transition-all ${weeklyBarColor(weeklyDrivingHours)}`}
            style={{ width: `${weeklyPct}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-[var(--ui-text-secondary)]">
          Wykorzystano {weeklyDrivingHours.toFixed(1)} h z {weeklyLimitHours} h limitu
          tygodniowego
        </p>

        {approachingLimit && (
          <p
            className="mt-2 rounded-md border border-amber-400 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 dark:border-amber-300/80 dark:bg-amber-900/60 dark:text-amber-50"
            role="alert"
          >
            Zbliżasz się do tygodniowego limitu czasu jazdy
          </p>
        )}
      </section>
    </div>
  );
}
