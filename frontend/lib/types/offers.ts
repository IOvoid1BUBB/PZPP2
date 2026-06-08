export interface Offer {
  id: string;
  clientId: string;
  clientName: string;
  origin: string;
  destination: string;
  priceEur: number;
  weightKg: number;
  ldm: number;
}

/** Deterministic multi-criteria score — mirrors backend OfferScore. */
export interface OfferScore {
  offer_id: string;
  total_score: number;
  revenue_density_score: number;
  detour_penalty_score: number;
  fill_contribution_score: number;
  time_window_score: number;
  added_km: number;
  estimated_added_cost_eur: number;
}

export interface RankedOffersResponse {
  session_id: string;
  limit: number;
  scored_count: number;
  offers: RankedOfferRow[];
}

/** Scored offer row enriched with optional UI metadata. */
export interface RankedOfferRow extends OfferScore {
  ldm?: number;
  weight_kg?: number;
  price_eur?: number;
  stackable?: boolean;
  pickup_label?: string;
  delivery_label?: string;
}
