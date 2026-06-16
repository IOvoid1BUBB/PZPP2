"use client";

import { Suspense, type CSSProperties } from "react";
import nextDynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, PlusIcon } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { Card } from "@/components/loadmax/ui";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { fetchOffers, type MarketOffer } from "@/lib/api/marketClient";
import {
  addOfferToSession,
  fetchRankedOffers,
  simulateMarketOffers,
  AddOfferError,
} from "@/lib/api/sessionClient";
import { useHydratedSessionId } from "@/hooks/useHydratedSessionId";
import {
  getCompanyColorHex,
  getCompanyColorPair,
} from "@/lib/colors/companyColors";
import { aggregateWeeklyEurLdm } from "@/lib/market/aggregateWeeklyEurLdm";
import { cn } from "@/lib/utils";

// Leaflet map loaded only client-side
const MarketHeatMap = nextDynamic(
  () => import("@/components/market/MarketHeatMap"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[460px] items-center justify-center bg-ui-raised text-sm text-ui-secondary">
        Ładowanie mapy…
      </div>
    ),
  },
);

export const dynamic = "force-dynamic";

type SortKey = "score" | "eurLdm" | "date" | "ldm";

const SORT_LABELS: Record<SortKey, string> = {
  score: "Score",
  eurLdm: "EUR/LDM",
  date: "Data",
  ldm: "LDM",
};

function shortId(id: string): string {
  return `#${id.slice(-4).toUpperCase()}`;
}

function coordLabel(lat: number, lon: number): string {
  return `${lat.toFixed(1)}°, ${lon.toFixed(1)}°`;
}

export default function MarketPage() {
  return (
    <Suspense
      fallback={
        <p className="text-sm text-ui-secondary">Wczytywanie giełdy…</p>
      }
    >
      <MarketPageInner />
    </Suspense>
  );
}

/** Point for heatmap: [lat, lon, intensity 0‥1] */
export interface HeatPoint {
  lat: number;
  lon: number;
  intensity: number;
  offerId: string;
  label: string;
}

function MarketPageInner() {
  const searchParams = useSearchParams();
  const sessionId = useHydratedSessionId();
  const { showToast } = useToast();

  const [offers, setOffers] = useState<MarketOffer[]>([]);
  const [scoreById, setScoreById] = useState<Map<string, number>>(new Map());
  const [labelById, setLabelById] = useState<
    Map<string, { pickup: string; delivery: string }>
  >(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("eurLdm");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadOffers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchOffers(100);
      setOffers(list);
      const queryOfferId = searchParams.get("offerId");
      setSelectedId(
        (current) => current ?? queryOfferId ?? list[0]?.id ?? null,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Nie udało się wczytać ofert.",
      );
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    void loadOffers();
  }, [loadOffers]);

  // Ranking scores + labels when active session exists
  useEffect(() => {
    if (!sessionId) {
      setScoreById(new Map());
      setLabelById(new Map());
      return;
    }
    let cancelled = false;
    void fetchRankedOffers(sessionId, 100)
      .then((response) => {
        if (cancelled) return;
        const scores = new Map<string, number>();
        const labels = new Map<string, { pickup: string; delivery: string }>();
        for (const row of response.offers) {
          scores.set(row.offer_id, row.total_score);
          if (row.pickup_label || row.delivery_label) {
            labels.set(row.offer_id, {
              pickup: row.pickup_label ?? "",
              delivery: row.delivery_label ?? "",
            });
          }
        }
        setScoreById(scores);
        setLabelById(labels);
      })
      .catch(() => {
        if (!cancelled) {
          setScoreById(new Map());
          setLabelById(new Map());
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const weekly = useMemo(() => aggregateWeeklyEurLdm(offers), [offers]);
  const weeklyMax = useMemo(
    () => Math.max(0, ...weekly.map((w) => w.avgValue)),
    [weekly],
  );

  const sortedOffers = useMemo(() => {
    const copy = [...offers];
    copy.sort((a, b) => {
      switch (sortKey) {
        case "score":
          return (scoreById.get(b.id) ?? 0) - (scoreById.get(a.id) ?? 0);
        case "ldm":
          return b.ldm - a.ldm;
        case "date":
          return (
            new Date(b.timeWindowOpen ?? 0).getTime() -
            new Date(a.timeWindowOpen ?? 0).getTime()
          );
        case "eurLdm":
        default:
          return b.eurPerLdm - a.eurPerLdm;
      }
    });
    return copy;
  }, [offers, sortKey, scoreById]);

  const selectedOffer = useMemo(
    () => offers.find((o) => o.id === selectedId) ?? null,
    [offers, selectedId],
  );

  const selectedColors = selectedOffer
    ? getCompanyColorPair(selectedOffer.id)
    : null;
  const selectedColorHex = selectedOffer
    ? getCompanyColorHex(selectedOffer.id)
    : null;

  const avgEurLdm = useMemo(() => {
    const valid = offers.filter((o) => o.eurPerLdm > 0);
    if (valid.length === 0) return 0;
    return valid.reduce((acc, o) => acc + o.eurPerLdm, 0) / valid.length;
  }, [offers]);

  function trendFor(offer: MarketOffer): string {
    if (avgEurLdm <= 0) return "—";
    const delta = ((offer.eurPerLdm - avgEurLdm) / avgEurLdm) * 100;
    return `${delta >= 0 ? "+" : ""}${delta.toFixed(0)}%`;
  }

  /**
   * Heat points: każda oferta wnosi dwa punkty (pickup + delivery).
   * Intensywność = score (gdy sesja aktywna) ALBO eurPerLdm znormalizowany.
   * Wyższy score/cena = jaśniejszy punkt na heatmapie.
   */
  const heatPoints = useMemo<HeatPoint[]>(() => {
    if (offers.length === 0) return [];
    const maxEur = Math.max(...offers.map((o) => o.eurPerLdm), 0.01);
    return offers.flatMap((offer) => {
      const rawScore = scoreById.get(offer.id) ?? offer.eurPerLdm / maxEur;
      const intensity = Math.min(1, Math.max(0.05, rawScore));
      const pickupLabel =
        labelById.get(offer.id)?.pickup ??
        coordLabel(offer.pickup.lat, offer.pickup.lon);
      const deliveryLabel =
        labelById.get(offer.id)?.delivery ??
        coordLabel(offer.delivery.lat, offer.delivery.lon);
      return [
        {
          lat: offer.pickup.lat,
          lon: offer.pickup.lon,
          intensity,
          offerId: offer.id,
          label: pickupLabel,
        },
        {
          lat: offer.delivery.lat,
          lon: offer.delivery.lon,
          intensity: intensity * 0.7, // delivery slightly less intense
          offerId: offer.id,
          label: deliveryLabel,
        },
      ];
    });
  }, [offers, scoreById, labelById]);

  async function handleAddToPlan() {
    if (!sessionId || !selectedOffer) {
      showToast({
        type: "error",
        message: "Brak aktywnej sesji. Utwórz sesję w plannerze.",
      });
      return;
    }
    setAdding(true);
    try {
      await addOfferToSession(sessionId, selectedOffer.id);
      showToast({ type: "success", message: "Dodano ofertę do planu." });
    } catch (err) {
      const message =
        err instanceof AddOfferError && err.code === "insufficient_ldm"
          ? `Brak miejsca (LDM): wolne ${err.freeLdm ?? "?"}, wymagane ${err.requiredLdm ?? "?"}.`
          : err instanceof Error
            ? err.message
            : "Nie udało się dodać oferty.";
      showToast({ type: "error", message });
    } finally {
      setAdding(false);
    }
  }

  async function handleGenerate() {
    if (!sessionId) {
      showToast({
        type: "error",
        message: "Utwórz sesję w plannerze, aby wygenerować oferty testowe.",
      });
      return;
    }
    setGenerating(true);
    try {
      await simulateMarketOffers(sessionId, 100);
      await loadOffers();
      showToast({ type: "success", message: "Wygenerowano oferty testowe." });
    } catch (err) {
      showToast({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Nie udało się wygenerować ofert.",
      });
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-ui-secondary">Wczytywanie giełdy…</p>;
  }

  if (error) {
    return (
      <p className="text-sm text-ui-error" role="alert">
        {error}
      </p>
    );
  }

  if (offers.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center gap-4 p-12 text-center">
        <p className="text-base text-ui-secondary">Brak ofert na giełdzie.</p>
        <Button
          variant="primary"
          disabled={generating}
          onClick={() => void handleGenerate()}
        >
          {generating ? "Generowanie…" : "Wygeneruj oferty testowe"}
        </Button>
        {!sessionId && (
          <p className="text-sm text-ui-muted">
            Najpierw utwórz sesję w zakładce Planning lab.
          </p>
        )}
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 h-[calc(100dvh-12rem)] mb-6 max-h-screen gap-6 lg:grid-cols-[300px_1fr]">
      {/* ── Lewa: lista ofert ──────────────────────────────────────── */}
      <aside className="flex flex-col px-2 overflow-y-auto gap-4 bg-ui-surface py-2 roudned-2xl">
        <h2 className="px-1 text-lg font-semibold text-ui-primary">Offers</h2>
        {sortedOffers.slice(0, 20).map((offer) => {
          const selected = selectedId === offer.id;
          const colors = getCompanyColorPair(offer.id);
          const score = scoreById.get(offer.id);
          const labels = labelById.get(offer.id);
          const pickupLabel =
            labels?.pickup ?? coordLabel(offer.pickup.lat, offer.pickup.lon);
          const deliveryLabel =
            labels?.delivery ??
            coordLabel(offer.delivery.lat, offer.delivery.lon);
          const route = `${pickupLabel} → ${deliveryLabel}`;
          return (
            <button
              key={offer.id}
              type="button"
              onClick={() => setSelectedId(offer.id)}
              style={
                {
                  "--offer-muted": colors.muted,
                  "--offer-intense": colors.intense,
                } as CSSProperties
              }
              className={cn(
                "rounded-2xl border p-4 text-left transition-colors",
                "border-[color-mix(in_srgb,var(--offer-intense)_35%,var(--ui-border))]",
                "bg-[var(--offer-muted)]",
                "hover:border-[color-mix(in_srgb,var(--offer-intense)_65%,var(--ui-border))]",
                selected && "ring-2 ring-[var(--offer-intense)]",
              )}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-[var(--offer-intense)]">
                    {pickupLabel || "Oferta"}
                  </p>
                  <p className="text-xs text-ui-muted">{shortId(offer.id)}</p>
                </div>
                <span className="mt-0.5 flex size-4 items-center justify-center rounded-full border border-[var(--offer-intense)]">
                  {selected && (
                    <span className="size-2 rounded-full bg-[var(--offer-intense)]" />
                  )}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-y-3 text-sm">
                <div>
                  <p className="text-xs text-ui-muted">Trasa</p>
                  <p className="mt-1 line-clamp-2 font-medium text-ui-primary">
                    {route}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-ui-muted">
                    {score != null ? "Score" : "Cena"}
                  </p>
                  <p className="mt-1 font-medium text-ui-primary">
                    {score != null
                      ? score.toFixed(2)
                      : `${offer.priceEur.toFixed(0)} EUR`}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-ui-muted">EUR/LDM</p>
                  <p className="mt-1 font-medium text-ui-primary">
                    {offer.eurPerLdm.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-ui-muted">Trend</p>
                  <p className="mt-1 font-medium text-[var(--offer-intense)]">
                    {trendFor(offer)}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </aside>

      {/* ── Prawa: chips + wykres + mapa ──────────────────────────── */}
      <div className="flex flex-col gap-6">
        {/* Summary chips + sort + add button */}
        <div className="flex flex-wrap items-center gap-3">
          {selectedOffer && (
            <>
              <div className="flex flex-col gap-2 rounded-md bg-ui-surface p-4">
                <span className="text-xs text-ui-secondary">EUR/LDM</span>
                <span className="text-sm font-semibold text-ui-primary">
                  {selectedOffer.eurPerLdm.toFixed(2)}
                </span>
              </div>
              <div className="flex flex-col gap-2 rounded-md bg-ui-surface p-4">
                <span className="text-xs text-ui-secondary">LDM</span>
                <span className="text-sm font-semibold text-ui-primary">
                  {selectedOffer.ldm.toFixed(1)}
                </span>
              </div>
              <div className="flex flex-col gap-2 rounded-md bg-ui-surface p-4">
                <span className="text-xs text-ui-secondary">Trend vs avg</span>
                <span className="text-sm font-semibold text-ui-primary">
                  {trendFor(selectedOffer)}
                </span>
              </div>
              <Button
                variant="primary"
                disabled={adding}
                onClick={() => void handleAddToPlan()}
                className="flex items-center gap-2"
              >
                {adding ? "Adding..." : "Add to plan"} <PlusIcon className="size-4" aria-hidden="true" />
              </Button>
            </>
          )}

          <label className="ml-auto flex items-center gap-2 rounded-xl border border-ui-border/70 bg-ui-surface px-4 py-2.5">
            <span>
              <span className="block text-xs text-ui-muted">Sortuj wg</span>
              <span className="text-sm font-medium text-ui-primary">
                {SORT_LABELS[sortKey]}
              </span>
            </span>
            <span className="relative">
              <select
                aria-label="Sortuj oferty"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="absolute inset-0 cursor-pointer opacity-0"
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABELS[key]}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="size-4 text-ui-muted"
                aria-hidden="true"
              />
            </span>
          </label>
        </div>

        {/* Weekly EUR/LDM chart */}
        <Card className="bg-ui-raised p-6">
          <p className="mb-3 text-sm font-semibold text-ui-primary">
            Średnia EUR/LDM (4 tygodnie)
          </p>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={weekly}
                margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
              >
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12, fill: "#6b7280" }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "#6b7280" }}
                />
                <Bar dataKey="avgValue" radius={[6, 6, 0, 0]}>
                  {weekly.map((week) => (
                    <Cell
                      key={week.label}
                      fill={
                        week.avgValue >= weeklyMax && weeklyMax > 0
                          ? (selectedColorHex ?? "#1a38f5")
                          : "#d1d5db"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[10px] text-ui-muted">EUR / LDM</p>
        </Card>

        {/*
         * Leaflet heatmap — CartoDB Positron tiles (pasujący motyw do UI).
         * Punkty = pickup + delivery wszystkich ofert, intensywność = score.
         * Wybrany punkt zaznaczony pinem.
         */}
        <Card className="h-[460px] overflow-hidden p-0">
          <MarketHeatMap
            heatPoints={heatPoints}
            selectedOffer={selectedOffer}
            onMarkerClick={(offerId) => setSelectedId(offerId)}
          />
        </Card>
      </div>
    </div>
  );
}
