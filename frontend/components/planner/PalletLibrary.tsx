"use client";

import { useDraggable } from "@dnd-kit/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
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
import { getCompanyColorPair } from "@/lib/colors/companyColors";
import type { OfferScore, RankedOfferRow } from "@/lib/types/offers";

const ROW_HEIGHT = 72;
const LIST_HEIGHT = 400;
const VIRTUAL_THRESHOLD = 50;
const FETCH_LIMIT = 50;

const FILTER_DEFAULTS = {
  stackable: false,
  maxDetour: 200,
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

  const badge =
    offer.total_score > 0.75 ? (
      <span className="offer-card__badge offer-card__badge--recommended">POLECANE</span>
    ) : offer.total_score < 0.2 ? (
      <span className="offer-card__badge offer-card__badge--discouraged">ODRADZONE</span>
    ) : isLoaded ? (
      <span className="offer-card__badge offer-card__badge--loaded">
        <span className="offer-card__badge-dot" aria-hidden="true" />
        Załadowano
      </span>
    ) : isLoading ? (
      <span className="offer-card__badge offer-card__badge--loading">Ładuje…</span>
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
}

function DraggableOfferRow({
  offer,
  style,
  isLoading,
  isLoaded,
  onAddClick,
}: DraggableOfferRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `library-${offer.offer_id}`,
    data: {
      type: "library-offer",
      offerId: offer.offer_id,
      offer,
    },
    disabled: isLoading || isLoaded,
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
        onAddClick={onAddClick}
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
  sessionId: string;
  loadedOfferIds?: Set<string>;
  onOfferAdded?: (session: SessionFullResponse) => void;
  onRegisterAddOffer?: (addOffer: (offerId: string) => Promise<void>) => void;
}

export function PalletLibrary({
  sessionId,
  loadedOfferIds: loadedOfferIdsProp,
  onOfferAdded,
  onRegisterAddOffer,
}: PalletLibraryProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  const [offers, setOffers] = useState<RankedOfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [loadingOfferId, setLoadingOfferId] = useState<string | null>(null);
  const [localLoadedIds, setLocalLoadedIds] = useState<Set<string>>(new Set());

  const filters = useMemo(
    () => ({
      stackableOnly: searchParams.get("stackable") === "true",
      maxDetourKm: Number(searchParams.get("max_detour") ?? FILTER_DEFAULTS.maxDetour),
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
      if (offer.added_km > filters.maxDetourKm) {
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
      setLoadingOfferId(offerId);
      try {
        const response = await addOfferToSession(sessionId, offerId);
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
    [onOfferAdded, sessionId, showToast],
  );

  useEffect(() => {
    onRegisterAddOffer?.(addOffer);
  }, [addOffer, onRegisterAddOffer]);

  useEffect(() => {
    let cancelled = false;

    async function loadOffers() {
      setLoading(true);
      setFetchError(null);
      try {
        const response = await fetchRankedOffers(sessionId, FETCH_LIMIT);
        if (cancelled) {
          return;
        }
        setOffers(response.offers);
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

  const handleSimulate = useCallback(async () => {
    setSimulating(true);
    try {
      const result = await simulateMarketOffers(sessionId, 200);
      showToast({
        type: "success",
        message: `Wygenerowano ${result.inserted} ofert (pominięto ${result.skipped}).`,
      });
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
    />
  );

  return (
    <aside className="pallet-library offer-sidebar" aria-label="Biblioteka ofert">
      <header className="pallet-library__header">
        <h2 className="pallet-library__title">Oferty</h2>
        <span className="pallet-library__count">
          {filteredOffers.length} / {offers.length}
        </span>
      </header>

      {offers.length === 0 && !loading ? (
        <button
          type="button"
          className="button button--secondary mb-3 w-full"
          disabled={simulating}
          onClick={() => void handleSimulate()}
        >
          {simulating ? "Generowanie…" : "Generuj oferty rynkowe"}
        </button>
      ) : null}

      <div className="pallet-library__filters">
        <label className="pallet-library__filter">
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
          Tylko stackowalne
        </label>

        <label className="pallet-library__filter">
          <span>Max detour: {filters.maxDetourKm} km</span>
          <input
            type="range"
            min={0}
            max={500}
            step={10}
            value={filters.maxDetourKm}
            onChange={(event) =>
              updateFilter("max_detour", event.target.value, String(FILTER_DEFAULTS.maxDetour))
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
