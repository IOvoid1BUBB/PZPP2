import type {
  BriefingStop,
  DriverRouteBriefing,
} from "@/lib/types/driverBriefing";

function formatCoord(value: number): string {
  return value.toFixed(5);
}

/** Relative ETA from route start, e.g. "+45 min" or "+2 h 05 min". */
export function formatEtaFromStart(minutes: number | null): string {
  if (minutes == null) {
    return "—";
  }
  if (minutes < 60) {
    return `+${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `+${hours} h ${String(mins).padStart(2, "0")} min`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString("pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function stopLabel(stop: BriefingStop): string {
  return stop.stopType === "pickup" ? "Odbiór" : "Dostawa";
}

function formatStop(stop: BriefingStop, index: number): string {
  const lines = [
    `${index + 1}. ${stop.pinLabel} — ${stopLabel(stop)}`,
    `   Adres: ${stop.addressLabel}`,
    `   GPS: ${formatCoord(stop.location.lat)}, ${formatCoord(stop.location.lon)}`,
    `   ETA: ${formatEtaFromStart(stop.etaMinutesFromStart)} | Obsługa: ${
      stop.handlingTimeMinutes != null ? `${stop.handlingTimeMinutes} min` : "—"
    }`,
    `   Mapa: ${stop.mapsLink}`,
  ];
  return lines.join("\n");
}

/**
 * Render a driver briefing as a multi-line plain-text block suitable for
 * SMS / WhatsApp / email.
 */
export function formatRouteBriefingPlainText(
  briefing: DriverRouteBriefing,
): string {
  const header = [
    `PLAN TRASY — ${formatDate(briefing.generatedAt)}`,
    `Kierowca: ${briefing.driverName} | Pojazd: ${briefing.vehicleName}`,
    `Start: ${formatCoord(briefing.origin.lat)}, ${formatCoord(
      briefing.origin.lon,
    )}`,
    `Dystans: ${briefing.totals.distanceKm.toFixed(1)} km | Czas: ${
      briefing.totals.durationMinutes
    } min | Postoje: ${briefing.totals.stopCount}`,
  ].join("\n");

  if (briefing.stops.length === 0) {
    return `${header}\n\nBrak zaplanowanych postojów.`;
  }

  const body = briefing.stops
    .map((stop, index) => formatStop(stop, index))
    .join("\n\n");

  return `${header}\n\n${body}`;
}
