import type { DriverRestPoint, RouteStop } from "@/lib/types/routeMap";

export type TimelineEventKind =
  | "origin"
  | "pickup"
  | "delivery"
  | "break_45"
  | "rest_11h";

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  title: string;
  subtitle: string | null;
  /** Minutes from route start, or null when timing is unknown. */
  atMinute: number | null;
  /** Sort key (resolved minute, carried forward when timing is missing). */
  sort: number;
}

const ICONS: Record<
  TimelineEventKind,
  { glyph: string; bg: string; fg: string }
> = {
  origin: { glyph: "⌂", bg: "bg-blue-600", fg: "text-white" },
  pickup: { glyph: "P", bg: "bg-green-600", fg: "text-white" },
  delivery: { glyph: "D", bg: "bg-blue-600", fg: "text-white" },
  break_45: { glyph: "☕", bg: "bg-purple-700", fg: "text-white" },
  rest_11h: { glyph: "🌙", bg: "bg-purple-700", fg: "text-white" },
};

/** Format minutes-from-start as a "+ Hh Mmin" offset label. */
export function formatRouteOffset(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hours === 0) {
    return `+ ${mins} min`;
  }
  if (mins === 0) {
    return `+ ${hours} h`;
  }
  return `+ ${hours} h ${mins} min`;
}

function restAfterLabel(afterDrivingMinutes: number): string {
  const hours = Math.round((afterDrivingMinutes / 60) * 10) / 10;
  return `Po ${hours.toLocaleString("pl-PL", { maximumFractionDigits: 1 })} h jazdy`;
}

/**
 * Merge stops and rest points into one chronological list.
 *
 * Stops are ordered by `sequenceOrder` and use `etaMinutesFromStart` for
 * timing; when an ETA is missing the previous known minute is carried forward
 * so route order is preserved. Rest points are interleaved by `atRouteMinute`.
 */
export function buildTimelineEvents(
  stops: RouteStop[],
  restPoints: DriverRestPoint[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      id: "origin",
      kind: "origin",
      title: "Baza",
      subtitle: "Start trasy",
      atMinute: 0,
      sort: 0,
    },
  ];

  const orderedStops = [...stops].sort(
    (a, b) => a.sequenceOrder - b.sequenceOrder,
  );

  let lastKnownMinute = 0;
  for (const stop of orderedStops) {
    const eta = stop.etaMinutesFromStart;
    if (eta != null) {
      lastKnownMinute = eta;
    }
    events.push({
      id: `stop-${stop.id}`,
      kind: stop.stopType,
      title: stop.pinLabel,
      subtitle: stop.addressLabel,
      atMinute: eta,
      sort: eta ?? lastKnownMinute,
    });
  }

  restPoints.forEach((rest, index) => {
    events.push({
      id: `rest-${rest.legId}-${rest.atRouteMinute}-${index}`,
      kind: rest.restType,
      title: rest.restType === "break_45" ? "Przerwa 45 min" : "Nocleg 11h",
      subtitle: restAfterLabel(rest.afterDrivingMinutes),
      atMinute: rest.atRouteMinute,
      sort: rest.atRouteMinute,
    });
  });

  // Array#sort is stable: ties keep insertion order, so a rest point that
  // shares a minute with a stop renders right after it.
  return events.sort((a, b) => a.sort - b.sort);
}

export interface RouteTimelineProps {
  stops: RouteStop[];
  restPoints: DriverRestPoint[];
  totalDurationMinutes: number;
}

/**
 * Vertical, chronological route timeline: base → pickups/deliveries with
 * mandatory breaks and overnight rests interleaved by minute.
 */
export function RouteTimeline({
  stops,
  restPoints,
  totalDurationMinutes,
}: RouteTimelineProps) {
  const events = buildTimelineEvents(stops ?? [], restPoints ?? []);

  const safeRestPoints = restPoints ?? [];
  const REST_DURATION_MIN: Record<DriverRestPoint["restType"], number> = {
    break_45: 45,
    rest_11h: 660,
  };
  const mandatoryBreakMinutes = safeRestPoints.reduce(
    (sum, rest) => sum + REST_DURATION_MIN[rest.restType],
    0,
  );

  // Only the origin event present → no actual stops yet.
  if (events.length <= 1) {
    return (
      <p className="px-4 py-6 text-center text-sm text-[var(--ui-text-secondary)]">
        Dodaj ładunki, aby zobaczyć trasę
      </p>
    );
  }

  return (
    <div className="px-4 py-3">
      <ol className="flex flex-col">
        {events.map((event, index) => {
          const icon = ICONS[event.kind];
          const isLast = index === events.length - 1;
          return (
            <li key={event.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`z-10 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${icon.bg} ${icon.fg}`}
                  aria-hidden="true"
                >
                  {icon.glyph}
                </span>
                {!isLast && (
                  <span className="w-px flex-1 bg-[var(--ui-border)]" />
                )}
              </div>
              <div className={`flex-1 ${isLast ? "pb-0" : "pb-5"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--ui-text-primary)]">
                    {event.title}
                  </span>
                  {event.atMinute != null && (
                    <span className="shrink-0 text-xs tabular-nums text-[var(--ui-text-muted)]">
                      {formatRouteOffset(event.atMinute)}
                    </span>
                  )}
                </div>
                {event.subtitle && (
                  <p className="mt-0.5 text-xs text-[var(--ui-text-secondary)]">
                    {event.subtitle}
                  </p>
                )}
                {(event.kind === "break_45" || event.kind === "rest_11h") && (
                  <p className="mt-0.5 text-xs italic text-[var(--ui-text-muted)]">
                    (wliczone w ETA kolejnych przystanków)
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {totalDurationMinutes > 0 && (
        <p className="mt-2 border-t border-[var(--ui-border)] pt-2 text-xs text-[var(--ui-text-muted)]">
          Całkowity czas trasy: {formatRouteOffset(totalDurationMinutes).replace("+ ", "")}
        </p>
      )}
      {safeRestPoints.length > 0 && (
        <p className="mt-1 text-xs text-[var(--ui-text-muted)]">
          W tym {safeRestPoints.length} przerw obowiązkowych (łącznie{" "}
          {mandatoryBreakMinutes} min)
        </p>
      )}
    </div>
  );
}
