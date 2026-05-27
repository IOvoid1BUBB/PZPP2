import type { CSSProperties } from "react";

import type { PalletData } from "@/lib/types/load";

interface OfferSidebarProps {
  slots: Record<string, PalletData | null>;
}

interface OfferCard {
  offerId: string;
  clientName: string;
  clientColor: string;
  ldm: number;
  weightKg: number;
  route: string;
  priceEur: number;
  score: number;
  timeWindow: string;
}

const ROUTE_BY_CLIENT: Record<string, string> = {
  "Alpha Logistics": "Berlin → Poznań",
  "Beta Sp. z o.o.": "Hamburg → Wrocław",
  "Gamma Transport": "Monachium → Kraków",
  "Delta Cargo": "Frankfurt → Gdańsk",
  IKEA: "Berlin → Poznań",
  Amazon: "Hamburg → Wrocław",
};

function buildOfferCards(slots: Record<string, PalletData | null>): OfferCard[] {
  const byOffer = new Map<string, OfferCard>();

  for (const pallet of Object.values(slots)) {
    if (!pallet) {
      continue;
    }

    const existing = byOffer.get(pallet.offerId);
    if (existing) {
      existing.ldm += pallet.ldm;
      existing.weightKg += pallet.weightKg;
      continue;
    }

    byOffer.set(pallet.offerId, {
      offerId: pallet.offerId,
      clientName: pallet.clientName,
      clientColor: pallet.clientColor,
      ldm: pallet.ldm,
      weightKg: pallet.weightKg,
      route: ROUTE_BY_CLIENT[pallet.clientName] ?? "Berlin → Poznań",
      priceEur: Math.round(pallet.ldm * 187.5),
      score: 4.2 + (pallet.offerId.charCodeAt(pallet.offerId.length - 1) % 7) * 0.1,
      timeWindow: pallet.timeWindow
        ? `${new Date(pallet.timeWindow.open).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })} - ${new Date(pallet.timeWindow.close).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}`
        : "8:00 - 10:00",
    });
  }

  return Array.from(byOffer.values());
}

export function OfferSidebar({ slots }: OfferSidebarProps) {
  const offers = buildOfferCards(slots);

  return (
    <aside className="offer-sidebar" aria-label="Dostępne oferty">
      {offers.map((offer) => (
        <article
          key={offer.offerId}
          className="offer-card"
          style={{ "--offer-accent": offer.clientColor } as CSSProperties}
        >
          <header className="offer-card__header">
            <div className="offer-card__title">
              <strong>{offer.clientName}</strong>
              <span className="offer-card__id">#{offer.offerId.toUpperCase()}</span>
            </div>
            <span className="offer-card__badge" aria-label="Status oferty">
              <span className="offer-card__badge-dot" aria-hidden="true" />
              Loaded
            </span>
          </header>
          <p className="offer-card__route">{offer.route}</p>
          <dl className="offer-card__meta">
            <div>
              <dt>LDM / Waga</dt>
              <dd>
                {offer.ldm.toFixed(1)} LDM / {offer.weightKg} kg
              </dd>
            </div>
            <div>
              <dt>Cena</dt>
              <dd>{offer.priceEur} EUR</dd>
            </div>
            <div>
              <dt>Okno czasowe</dt>
              <dd>{offer.timeWindow}</dd>
            </div>
            <div>
              <dt>Score</dt>
              <dd>{offer.score.toFixed(1)}</dd>
            </div>
          </dl>
        </article>
      ))}
    </aside>
  );
}
