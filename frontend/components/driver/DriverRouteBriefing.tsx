"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { fetchSessionRouteMap } from "@/lib/api/mapClient";
import {
  fetchSessionDetail,
  type SessionDetailResponse,
} from "@/lib/api/sessionClient";
import { buildRouteBriefing } from "@/lib/driver/buildRouteBriefing";
import { formatRouteBriefingPlainText } from "@/lib/driver/formatRouteBriefingText";
import type { RouteMapData } from "@/lib/types/routeMap";

export interface DriverRouteBriefingProps {
  sessionId: string;
  variant?: "compact" | "full";
  className?: string;
}

function classes(...items: Array<string | false | undefined>): string {
  return items.filter(Boolean).join(" ");
}

export function DriverRouteBriefing({
  sessionId,
  variant = "full",
  className,
}: DriverRouteBriefingProps) {
  const { showToast } = useToast();
  const [routeMap, setRouteMap] = useState<RouteMapData | null>(null);
  const [sessionDetail, setSessionDetail] =
    useState<SessionDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [map, detail] = await Promise.all([
          fetchSessionRouteMap(sessionId),
          fetchSessionDetail(sessionId).catch(() => null),
        ]);
        if (!cancelled) {
          setRouteMap(map);
          setSessionDetail(detail);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Nie udało się wczytać planu trasy.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const briefing = useMemo(
    () => (routeMap ? buildRouteBriefing(routeMap, sessionDetail) : null),
    [routeMap, sessionDetail],
  );

  const hasStops = briefing != null && briefing.stops.length > 0;
  const briefingText = useMemo(
    () => (briefing && hasStops ? formatRouteBriefingPlainText(briefing) : ""),
    [briefing, hasStops],
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(briefingText);
      showToast({ type: "success", message: "Plan trasy skopiowany do schowka." });
    } catch {
      showToast({ type: "error", message: "Nie udało się skopiować planu." });
    }
  }

  async function handleShare() {
    const title = `Plan trasy ${sessionId.slice(0, 8)}`;
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text: briefingText });
        return;
      } catch (err) {
        // User aborted share — do not surface as an error.
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
      }
    }
    await handleCopy();
  }

  const mailtoHref = useMemo(() => {
    const subject = encodeURIComponent(`Plan trasy ${sessionId.slice(0, 8)}`);
    const body = encodeURIComponent(briefingText);
    return `mailto:?subject=${subject}&body=${body}`;
  }, [sessionId, briefingText]);

  if (loading) {
    return (
      <div
        data-testid="driver-route-briefing"
        className={classes("text-sm text-[var(--ui-text-secondary)]", className)}
      >
        Wczytywanie planu trasy…
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-testid="driver-route-briefing"
        className={classes("text-sm text-[var(--ui-error)]", className)}
        role="alert"
      >
        {error}
      </div>
    );
  }

  if (!hasStops) {
    return (
      <div
        data-testid="driver-route-briefing"
        className={classes("text-sm text-[var(--ui-text-secondary)]", className)}
      >
        No stops to send. Add offers to the session to generate a plan for the driver.
      </div>
    );
  }

  return (
    <section
      data-testid="driver-route-briefing"
      className={classes("flex flex-col gap-3", className)}
      aria-label="Plan trasy dla kierowcy"
    >
      {variant === "full" ? (
        <textarea
          readOnly
          aria-label="Podgląd planu trasy"
          value={briefingText}
          className="h-64 w-full resize-y rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] p-3 font-mono text-xs text-[var(--ui-text-primary)]"
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={() => void handleCopy()}
          aria-label="Kopiuj plan trasy do schowka"
        >
          Kopiuj do schowka
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void handleShare()}
          aria-label="Udostępnij plan trasy"
        >
          Udostępnij
        </Button>
        {variant === "full" ? (
          <a
            href={mailtoHref}
            className="inline-flex items-center justify-center rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface)] px-4 py-2 text-sm font-medium text-[var(--ui-text-primary)] transition-colors hover:bg-[var(--ui-surface-raised)]"
            aria-label="Wyślij plan trasy e-mailem"
          >
            Wyślij e-mailem
          </a>
        ) : null}
      </div>
    </section>
  );
}
