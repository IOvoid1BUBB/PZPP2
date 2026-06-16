"use client";

import { useDraggable } from "@dnd-kit/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { List, type RowComponentProps } from "react-window";

import { useToast } from "@/components/ui/Toast";
import {
  AddOfferError,
  addOfferToSession,
  fetchRankedOffers,
  simulateMarketOffers,
  type SessionFullResponse,
} from "@/lib/api/sessionClient";
import { fetchOffers, simulateMarketOffersGlobal, type MarketOffer } from "@/lib/api/marketClient";
import { coordToLabel } from "@/lib/geo/majorHubs";
import { getCompanyColorPair } from "@/lib/colors/companyColors";
import type { OfferScore, RankedOfferRow } from "@/lib/types/offers";

const ROW_HEIGHT = 88;
const LIST_HEIGHT = 400;
const VIRTUAL_THRESHOLD = 50;
const FETCH_LIMIT = 50;

const FILTER_DEFAULTS = {
  stackable: false,
  minScore: 0,
} as const;

const SCORE_COLORS = {
  revenue: "#1D9E75",
  detour: "#534AB7",
  fill: "#F5A623",
  timeWindow: "#E8564A",
} as const;

export function ScoreBar({ score }: { score: OfferScore }) {
  const segments = useMemo(() => {
    const detour = Math.max(0, score.detour_penalty_score);
    const values = [
      { key: "revenue", value: score.revenue_density_score, color: SCORE_COLORS.revenue, label: "Przychód" },
      { key: "detour", value: detour, color: SCORE_COLORS.detour, label: "Detour" },
      { key: "fill", value: score.fill_contribution_score, color: SCORE_COLORS.fill, label: "Fill" },
      { key: "time", value: score.time_window_score, color: SCORE_COLORS.timeWindow, label: "Okno" },
    ];
    const total = values.reduce((sum, segment) => sum + segment.value, 0) || 1;

    return values.map((segment) => ({
      ...segment,
      flex: Math.max(2, (segment.value / total) * 100),
      pct: Math.round(segment.value * 100),
    }));
  }, [score]);

  return (
    <div className="score-bar" role="img" aria-label={`Score ${score.total_score.toFixed(2)}`}>
      {segments.map((segment) => (
        <span
          key={segment.key}
          className="score-bar__segment"
          style={{
            flex: segment.flex,
            backgroundColor: segment.color,
            minWidth: 2,
          }}
          title={`${segment.label}: ${segment.pct}%`}
        />
      ))}
    </div>
  );
}

interface OfferRowProps {
  offer: RankedOfferRow;
  style?: CSSProperties;
  isLoading: boolean;
  isLoaded: boolean;
  onAddClick?: () => void;
}

export function OfferRow({
  offer,
  style,
  isLoading,
  isLoaded,
  onAddClick,
}: OfferRowProps) {
  const colors = getCompanyColorPair(offer.offer_id);
  const route =
    offer.pickup_label && offer.delivery_label
      ? `${offer.pickup_label} → ${offer.delivery_label}`
      : offer.offer_id.slice(0, 8).toUpperCase();

  const badge = isLoading ? (
    <span className="offer-card__badge offer-card__badge--loading">Ładuje…</span>
  ) : isLoaded ? (
    <span className="offer-card__badge offer-card__badge--loaded">
      <span className="offer-card__badge-dot" aria-hidden="true" />
      Załadowano
    </span>
  ) : offer.total_score > 0.75 ? (
    <span className="offer-card__badge offer-card__badge--recommended">POLECANE</span>
  ) : offer.total_score < 0.2 ? (
    <span className="offer-card__badge offer-card__badge--discouraged">ODRADZONE</span>
  ) : offer.added_km < 10 ? (
    <span className="offer-card__badge offer-card__badge--on-route">NA TRASIE</span>
  ) : null;

  return (
    <article
      className={[
        "offer-card",
        "offer-card--library",
        isLoading ? "offer-card--loading" : "",
        isLoaded ? "offer-card--loaded" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        {
          ...style,
          "--offer-muted": colors.muted,
          "--offer-intense": colors.intense,
        } as CSSProperties
      }
    >
      <header className="offer-card__header">
        <div className="offer-card__title">
          <div className="offer-card__score-row">
            <ScoreBar score={offer} />
            <span className="offer-card__total-score">
              {offer.total_score.toFixed(2)}
            </span>
          </div>
          <span className="offer-card__id">#{offer.offer_id.slice(0, 8).toUpperCase()}</span>
        </div>
        {badge}
      </header>

      <p className="offer-card__route">{route}</p>

      <dl className="offer-card__meta offer-card__meta--compact">
        <div>
          <dt>LDM / Waga</dt>
          <dd>
            {(offer.ldm ?? 0).toFixed(1)} LDM / {offer.weight_kg ?? 0} kg
          </dd>
        </div>
        <div>
          <dt>Detour</dt>
          <dd>{offer.added_km.toFixed(0)} km</dd>
        </div>
        <div>
          <dt>Koszt</dt>
          <dd>{offer.estimated_added_cost_eur.toFixed(0)} EUR</dd>
        </div>
        <div>
          <dt>Cena</dt>
          <dd>{offer.price_eur ?? 0} EUR</dd>
        </div>
      </dl>

      {!isLoaded && !isLoading && onAddClick ? (
        <button
          type="button"
          className="offer-card__add button button--secondary"
          onClick={onAddClick}
        >
          Dodaj
        </button>
      ) : null}
    </article>
  );
}

interface DraggableOfferRowProps extends OfferRowProps {
  offer: RankedOfferRow;
  isReadOnly?: boolean;
}

function DraggableOfferRow({
  offer,
  style,
  isLoading,
  isLoaded,
  onAddClick,
  isReadOnly = false,
}: DraggableOfferRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `library-${offer.offer_id}`,
    data: {
      type: "library-offer",
      offerId: offer.offer_id,
      offer,
    },
    disabled: isLoading || isLoaded || isReadOnly,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ ...style, touchAction: "none", opacity: isDragging ? 0.5 : 1 }}
    >
      <OfferRow
        offer={offer}
        isLoading={isLoading}
        isLoaded={isLoaded}
        onAddClick={isReadOnly ? undefined : onAddClick}
      />
    </div>
  );
}

type VirtualRowProps = {
  offers: RankedOfferRow[];
  loadingOfferId: string | null;
  loadedOfferIds: Set<string>;
  onAddClick: (offerId: string) => void;
};

function VirtualOfferRow({
  index,
  style,
  offers,
  loadingOfferId,
  loadedOfferIds,
  onAddClick,
}: RowComponentProps<VirtualRowProps>) {
  const offer = offers[index];
  if (!offer) {
    return null;
  }

  return (
    <DraggableOfferRow
      offer={offer}
      style={style}
      isLoading={loadingOfferId === offer.offer_id}
      isLoaded={loadedOfferIds.has(offer.offer_id)}
      onAddClick={() => onAddClick(offer.offer_id)}
    />
  );
}

export interface PalletLibraryProps {
  /** When provided — ranked mode (session-aware scoring). When null/undefined — market mode. */
  sessionId?: string | null;
  /** Vehicle type UUID — enables lazy session creation on add (click). */
  vehicleId?: string | null;
  loadedOfferIds?: Set<string>;
  onOfferAdded?: (session: SessionFullResponse) => void;
  onOfferRemoved?: (offerId: string) => void;
  onLocalOfferAdd?: (offer: RankedOfferRow) => void;
  onRegisterAddOffer?: (addOffer: (offerId: string) => Promise<void>) => void;
  onRegisterRemoveOffer?: (removeOffer: (offerId: string) => void) => void;
  isReadOnly?: boolean;
}

/** Convert a raw MarketOffer (no session) into a RankedOfferRow shape for rendering. */
function marketOfferToRow(offer: MarketOffer): RankedOfferRow {
  return {
    offer_id: offer.id,
    total_score: 0,
    revenue_density_score: 0,
    detour_penalty_score: 0,
    fill_contribution_score: 0,
    time_window_score: 0,
    added_km: 0,
    estimated_added_cost_eur: 0,
    ldm: offer.ldm,
    weight_kg: offer.weightKg,
    price_eur: offer.priceEur,
    stackable: offer.stackable,
    pickup_label: offer.pickupLabel
      ?? coordToLabel(offer.pickup.lat, offer.pickup.lon),
    delivery_label: offer.deliveryLabel
      ?? coordToLabel(offer.delivery.lat, offer.delivery.lon),
  };
}

export function PalletLibrary({
  sessionId,
  vehicleId,
  loadedOfferIds: loadedOfferIdsProp,
  onOfferAdded,
  onOfferRemoved,
  onLocalOfferAdd,
  onRegisterAddOffer,
  onRegisterRemoveOffer,
  isReadOnly = false,
}: PalletLibraryProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  const [offers, setOffers] = useState<RankedOfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [autoSimulated, setAutoSimulated] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [loadingOfferId, setLoadingOfferId] = useState<string | null>(null);
  const [localLoadedIds, setLocalLoadedIds] = useState<Set<string>>(new Set());
  /** true = ranked session mode; false = raw market mode */
  const isRankedMode = Boolean(sessionId);

  const filters = useMemo(
    () => ({
      stackableOnly: searchParams.get("stackable") === "true",
      minScore: Number(searchParams.get("min_score") ?? FILTER_DEFAULTS.minScore),
    }),
    [searchParams],
  );

  const loadedOfferIds = useMemo(() => {
    const merged = new Set(localLoadedIds);
    loadedOfferIdsProp?.forEach((id) => merged.add(id));
    return merged;
  }, [localLoadedIds, loadedOfferIdsProp]);

  const updateFilter = useCallback(
    (key: string, value: string, defaultValue: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === defaultValue) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      const sessionParam = searchParams.get("session");
      if (sessionParam) {
        params.set("session", sessionParam);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const filteredOffers = useMemo(() => {
    return offers.filter((offer) => {
      if (offer.total_score < filters.minScore) {
        return false;
      }
      if (filters.stackableOnly && offer.stackable !== true) {
        return false;
      }
      return true;
    });
  }, [offers, filters]);

  const addOffer = useCallback(
    async (offerId: string) => {
      const activeSessionId = sessionId;

      if (!activeSessionId) {
        // Pre-session mode: find the offer and call local placement callback
        const offer = offers.find((o) => o.offer_id === offerId);
        if (offer && onLocalOfferAdd) {
          onLocalOfferAdd(offer);
          setLocalLoadedIds((prev) => new Set(prev).add(offerId));
        } else if (!onLocalOfferAdd) {
          showToast({
            type: "info",
            message: "Wybierz pojazd i przeciągnij ładunek na naczepę.",
          });
        }
        return;
      }

      setLoadingOfferId(offerId);
      try {
        const response = await addOfferToSession(activeSessionId, offerId);
        setLocalLoadedIds((prev) => new Set(prev).add(offerId));
        onOfferAdded?.(response);
      } catch (err) {
        if (err instanceof AddOfferError && err.code === "insufficient_ldm") {
          showToast({
            type: "error",
            message: `Brak LDM — wolne: ${err.freeLdm ?? "?"} LDM`,
          });
        } else {
          showToast({
            type: "error",
            message:
              err instanceof AddOfferError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : "Błąd dodawania",
          });
        }
      } finally {
        setLoadingOfferId(null);
      }
    },
    [onOfferAdded, onLocalOfferAdd, offers, sessionId, showToast],
  );

  useEffect(() => {
    onRegisterAddOffer?.(addOffer);
  }, [addOffer, onRegisterAddOffer]);

  // Expose a callback so SlotEditor can mark an offer as unloaded
  const removeOfferLocally = useCallback(
    (offerId: string) => {
      setLocalLoadedIds((prev) => {
        const next = new Set(prev);
        next.delete(offerId);
        return next;
      });
      onOfferRemoved?.(offerId);
    },
    [onOfferRemoved],
  );

  useEffect(() => {
    onRegisterRemoveOffer?.(removeOfferLocally);
  }, [onRegisterRemoveOffer, removeOfferLocally]);

  useEffect(() => {
    let cancelled = false;

    async function loadOffers() {
      setLoading(true);
      setFetchError(null);
      try {
        if (sessionId) {
          // Ranked mode — session-aware scoring
          const response = await fetchRankedOffers(sessionId, FETCH_LIMIT);
          if (cancelled) return;
          setOffers(response.offers);
        } else {
          // Market mode — fallback to all market offers sorted by EUR/LDM
          const raw = await fetchOffers(200);
          if (cancelled) return;
          const sorted = [...raw].sort((a, b) => b.priceEur / b.ldm - a.priceEur / a.ldm);
          setOffers(sorted.map(marketOfferToRow));
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(
            err instanceof Error ? err.message : "Nie udało się wczytać ofert.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadOffers();
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshToken]);

  // Auto-generate offers the first time the library loads with an empty DB
  useEffect(() => {
    if (!loading && !fetchError && offers.length === 0 && !autoSimulated && !simulating) {
      setAutoSimulated(true);
      void (async () => {
        setSimulating(true);
        try {
          if (sessionId) {
            const result = await simulateMarketOffers(sessionId, 200);
            showToast({
              type: "success",
              message: `Wygenerowano ${result.inserted} ofert testowych.`,
            });
          } else {
            const result = await simulateMarketOffersGlobal(200);
            showToast({
              type: "success",
              message: `Wygenerowano ${result.inserted} ofert testowych.`,
            });
          }
          setRefreshToken((t) => t + 1);
        } catch {
          // silent — user can click manually
        } finally {
          setSimulating(false);
        }
      })();
    }
  }, [autoSimulated, fetchError, loading, offers.length, sessionId, simulating, showToast]);

  const handleSimulate = useCallback(async () => {
    setSimulating(true);
    try {
      if (sessionId) {
        const result = await simulateMarketOffers(sessionId, 200);
        showToast({
          type: "success",
          message: `Wygenerowano ${result.inserted} ofert (pominięto ${result.skipped}).`,
        });
      } else {
        const result = await simulateMarketOffersGlobal(200);
        showToast({
          type: "success",
          message: `Wygenerowano ${result.inserted} ofert (pominięto ${result.skipped}).`,
        });
      }
      setRefreshToken((token) => token + 1);
    } catch (err) {
      showToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Nie udało się wygenerować ofert.",
      });
    } finally {
      setSimulating(false);
    }
  }, [sessionId, showToast]);

  const renderRow = (offer: RankedOfferRow) => (
    <DraggableOfferRow
      key={offer.offer_id}
      offer={offer}
      isLoading={loadingOfferId === offer.offer_id}
      isLoaded={loadedOfferIds.has(offer.offer_id)}
      onAddClick={() => void addOffer(offer.offer_id)}
      isReadOnly={isReadOnly}
    />
  );

  return (
    <aside className="pallet-library offer-sidebar" aria-label="Biblioteka ofert">
      <header className="pallet-library__header">
        <h2 className="pallet-library__title">Offers</h2>
        <div className="flex items-center gap-2">
          <span className="pallet-library__count">
            {filteredOffers.length} / {offers.length}
          </span>
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
              isRankedMode
                ? "bg-ui-accent/10 text-ui-accent"
                : "bg-ui-muted/20 text-ui-secondary"
            }`}
          >
            {isRankedMode ? "Oferty z rankingiem" : "Oferty rynkowe"}
          </span>
        </div>
      </header>

      {(offers.length === 0 && !loading) || simulating ? (
        <button
          type="button"
          className="button bg-ui-surface hover:bg-gray/20 transition-colors mb-3 w-full"
          disabled={simulating || isReadOnly}
          onClick={() => void handleSimulate()}
          title={isReadOnly ? "Sesja potwierdzona" : undefined}
        >
          {simulating ? "Generating offers…" : "Generate market offers"}
        </button>
      ) : null}

      <div className="pallet-library__filters">
        <label className="flex gap-2 text-xs">
        Only stackable
          <input
            type="checkbox"
            checked={filters.stackableOnly}
            onChange={(event) =>
              updateFilter(
                "stackable",
                event.target.checked ? "true" : "false",
                "false",
              )
            }
          />
          
        </label>

        <label className="pallet-library__filter">
          <span>Min score: {filters.minScore.toFixed(2)}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={filters.minScore}
            onChange={(event) =>
              updateFilter("min_score", event.target.value, String(FILTER_DEFAULTS.minScore))
            }
          />
        </label>
      </div>

      {loading ? (
        <p className="pallet-library__status">Wczytywanie ofert…</p>
      ) : fetchError ? (
        <p className="pallet-library__status pallet-library__status--error" role="alert">
          {fetchError}
        </p>
      ) : filteredOffers.length === 0 ? (
        <p className="pallet-library__status">Brak ofert dla wybranych filtrów.</p>
      ) : filteredOffers.length > VIRTUAL_THRESHOLD ? (
        <List
          data-testid="pallet-library-virtual-list"
          rowCount={filteredOffers.length}
          rowHeight={ROW_HEIGHT}
          rowComponent={VirtualOfferRow}
          rowProps={{
            offers: filteredOffers,
            loadingOfferId,
            loadedOfferIds,
            onAddClick: (offerId) => void addOffer(offerId),
          }}
          style={{ height: LIST_HEIGHT, width: "100%" }}
          className="pallet-library__list"
        />
      ) : (
        <div className="pallet-library__rows">
          {filteredOffers.map((offer) => renderRow(offer))}
        </div>
      )}
    </aside>
  );
}

/**
 * Suspense-wrapped version of PalletLibrary.
 * Use this anywhere PalletLibrary is rendered inside a client component tree
 * to satisfy Next.js requirement for useSearchParams() boundaries.
 */
export function PalletLibrarySuspense(props: PalletLibraryProps) {
  return (
    <Suspense
      fallback={
        <aside className="pallet-library offer-sidebar" aria-label="Biblioteka ofert">
          <p className="pallet-library__status">Wczytywanie ofert…</p>
        </aside>
      }
    >
      <PalletLibrary {...props} />
    </Suspense>
  );
}
