/**
 * @file buildAlerts.ts
 * Czysta funkcja budująca syntetyczny feed alertów dashboardu na podstawie
 * sesji, KPI, ofert rankingowych i walidacji czasu pracy kierowcy.
 * Brak dedykowanego endpointu — alerty wyprowadzamy po stronie klienta.
 */

import type {
  DashboardKpi,
  DashboardSessionSummary,
} from "@/lib/api/dashboardClient";
import type { RankedOfferRow } from "@/lib/types/offers";

export type AlertType = "info" | "warning" | "opportunity";

export interface Alert {
  id: string;
  type: AlertType;
  title: string;
  body: string;
  link?: string;
  href?: string;
}

export interface BuildAlertsInput {
  sessions: DashboardSessionSummary[];
  kpis: DashboardKpi;
  rankedOffers?: RankedOfferRow[];
  /** Sesja aktywna (do linków See offer → /market?offerId=). */
  activeSessionId?: string | null;
  complianceViolations?: number;
  /** Próg scoringu, powyżej którego oferta jest „gorąca”. */
  hotOfferScoreThreshold?: number;
  now?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Buduje listę alertów. Kolejność: ostrzeżenia compliance → niski wolumen
 * ofert → stare szkice → gorące oferty z giełdy → info o rynku.
 */
export function buildAlerts(input: BuildAlertsInput): Alert[] {
  const {
    sessions,
    kpis,
    rankedOffers = [],
    activeSessionId = null,
    complianceViolations = 0,
    hotOfferScoreThreshold = 2.0,
    now = Date.now(),
  } = input;

  const alerts: Alert[] = [];

  // 1. Naruszenia czasu pracy kierowcy (PDPTW / EU 561)
  if (complianceViolations > 0) {
    alerts.push({
      id: "compliance",
      type: "warning",
      title: "Ryzyko czasu pracy kierowcy",
      body: `Aktywna trasa narusza limity EU 561/2006 (${complianceViolations} ${
        complianceViolations === 1 ? "naruszenie" : "naruszeń"
      }). Rozważ podział trasy lub nocleg.`,
    });
  }

  // 2. Sesje z wolną przestrzenią / bez ofert — okazja do doładunku
  for (const session of sessions) {
    if (
      (session.status === "draft" || session.status === "optimizing") &&
      session.offer_count === 0
    ) {
      alerts.push({
        id: `empty-${session.id}`,
        type: "info",
        title: "Wolna przestrzeń",
        body: `Sesja ${shortId(session.id)}${
          session.vehicle_name ? ` (${session.vehicle_name})` : ""
        } nie ma jeszcze ofert. Znajdź doładunek!`,
        link: "Zaplanuj załadunek →",
        href: "/planner",
      });
    }
  }

  // 3. Szkice starsze niż 24h
  for (const session of sessions) {
    if (session.status !== "draft") {
      continue;
    }
    const ageMs = now - new Date(session.created_at).getTime();
    if (Number.isFinite(ageMs) && ageMs > DAY_MS) {
      alerts.push({
        id: `stale-${session.id}`,
        type: "warning",
        title: "Niedokończony plan",
        body: `Szkic ${shortId(session.id)} czeka ponad 24h. Dokończ planowanie lub usuń sesję.`,
        link: "Otwórz planner →",
        href: "/planner",
      });
    }
  }

  // 4. Gorące oferty z giełdy (wysoki scoring na trasie aktywnej sesji)
  const hotOffers = rankedOffers
    .filter((offer) => offer.total_score >= hotOfferScoreThreshold)
    .slice(0, 3);
  for (const offer of hotOffers) {
    const eurLdm =
      offer.price_eur && offer.ldm && offer.ldm > 0
        ? (offer.price_eur / offer.ldm).toFixed(2)
        : null;
    alerts.push({
      id: `hot-${offer.offer_id}`,
      type: "opportunity",
      title: "Nowa okazja (Hot Offer)",
      body: `Giełda: oferta o wysokim scoringu (${offer.total_score.toFixed(2)}${
        eurLdm ? `, ${eurLdm} EUR/LDM` : ""
      })${offer.delivery_label ? ` do ${offer.delivery_label}` : ""}.`,
      link: "Zobacz ofertę →",
      href: activeSessionId
        ? `/market?offerId=${offer.offer_id}`
        : `/market?offerId=${offer.offer_id}`,
    });
  }

  // 5. Informacja o rynku, gdy brak innych alertów wysokiej wagi
  if (kpis.market_offers_count > 0) {
    alerts.push({
      id: "market-volume",
      type: "opportunity",
      title: "Aktywna giełda",
      body: `Na rynku dostępnych jest ${kpis.market_offers_count} ofert. Sprawdź najlepiej rokujące trasy.`,
      link: "Przejdź do giełdy →",
      href: "/market",
    });
  }

  if (alerts.length === 0) {
    alerts.push({
      id: "empty-state",
      type: "info",
      title: "Wszystko pod kontrolą",
      body: "Brak alertów. Utwórz sesję lub wygeneruj oferty, aby rozpocząć planowanie.",
      link: "Otwórz planner →",
      href: "/planner",
    });
  }

  return alerts;
}

function shortId(id: string): string {
  return `#${id.slice(0, 4).toUpperCase()}`;
}
