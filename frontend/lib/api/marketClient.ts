/**
 * @file marketClient.ts
 * Klient API giełdy ofert (GET /api/v1/offers).
 * Mapuje snake_case + Decimal-as-string z backendu na camelCase + number.
 */

import { toNumber } from "@/lib/api/coerce";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export interface GeoPoint {
  lon: number;
  lat: number;
}

/** Reprezentacja oferty rynkowej (frontend) — zgodna z OfferRead z backendu. */
export interface MarketOffer {
  id: string;
  pickup: GeoPoint;
  delivery: GeoPoint;
  ldm: number;
  weightKg: number;
  priceEur: number;
  timeWindowOpen: string | null;
  timeWindowClose: string | null;
  handlingTimeMinutes: number | null;
  stackable: boolean;
  isWithinCorridor: boolean;
  /** Cena za metr ładunkowy (EUR/LDM) — wyliczane po stronie klienta. */
  eurPerLdm: number;
}

interface OfferApiRecord {
  id: string;
  pickup: { lon: number; lat: number };
  delivery: { lon: number; lat: number };
  ldm: number | string;
  weight_kg: number;
  price_eur: number | string;
  time_window_open: string | null;
  time_window_close: string | null;
  handling_time_minutes: number | null;
  stackable: boolean;
  is_within_corridor: boolean;
}

function mapOffer(raw: OfferApiRecord): MarketOffer {
  const ldm = toNumber(raw.ldm);
  const priceEur = toNumber(raw.price_eur);
  return {
    id: raw.id,
    pickup: { lon: raw.pickup.lon, lat: raw.pickup.lat },
    delivery: { lon: raw.delivery.lon, lat: raw.delivery.lat },
    ldm,
    weightKg: raw.weight_kg,
    priceEur,
    timeWindowOpen: raw.time_window_open,
    timeWindowClose: raw.time_window_close,
    handlingTimeMinutes: raw.handling_time_minutes,
    stackable: raw.stackable,
    isWithinCorridor: raw.is_within_corridor,
    eurPerLdm: ldm > 0 ? Math.round((priceEur / ldm) * 100) / 100 : 0,
  };
}

export async function fetchOffers(limit = 50, offset = 0): Promise<MarketOffer[]> {
  const response = await fetch(
    `${API_BASE}/api/v1/offers?limit=${limit}&offset=${offset}`,
  );
  if (!response.ok) {
    throw new Error(`Nie udało się pobrać ofert giełdy (${response.status})`);
  }
  const raw = (await response.json()) as OfferApiRecord[];
  return raw.map(mapOffer);
}
