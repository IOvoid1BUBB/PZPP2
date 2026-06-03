"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useShallow } from "zustand/shallow";

import { getCompanyColorHex } from "@/lib/colors/companyColors";
import type { ProfitBreakdownData } from "@/lib/api/profitClient";
import { resolveLegRows } from "@/lib/api/profitClient";
import { useClientHydrated } from "@/hooks/useClientHydrated";
import { useClientSummary, useLoadStore } from "@/lib/stores/loadStore";
import { useProfitBreakdown } from "@/hooks/useProfitBreakdown";

// ─── Chart colors (hard HEX — Recharts SVG cannot use CSS variables) ─────────

const COLOR_REVENUE = "#1D9E75";
const COLOR_COST = "#E24B4A";
const COLOR_PROFIT = "#534AB7";

type BarKind = "revenue" | "cost" | "profit";

interface WaterfallRow {
  key: string;
  label: string;
  bottom: number;
  amount: number;
  /** Recharts floating bar: [yMin, yMax] in chart units (EUR or L). */
  range: [number, number];
  displayValue: number;
  barKind: BarKind;
  formula?: string;
  fill?: string;
  valueUnit?: "eur" | "liters";
}

interface ClientRevenueSlice {
  clientId: string;
  name: string;
  revenue: number;
  fill: string;
}

export interface ProfitWaterfallProps {
  /** Optional override; defaults to live session profit from API. */
  data?: ProfitBreakdownData;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toWaterfallRange(bottom: number, amount: number): [number, number] {
  return [bottom, bottom + amount];
}

function formatLegLabel(legId: number): string {
  return `Odcinek ${legId}`;
}

function getBarColor(barKind: BarKind, displayValue: number): string {
  if (barKind === "revenue") return COLOR_REVENUE;
  if (barKind === "cost") return COLOR_COST;
  return displayValue >= 0 ? COLOR_PROFIT : COLOR_COST;
}

function formatEur(value: number, signed = false): string {
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${value.toLocaleString("pl-PL")} EUR`;
}

function buildFormula(
  key: string,
  meta: ProfitBreakdownData["formulas"][keyof ProfitBreakdownData["formulas"]],
): string | undefined {
  switch (key) {
    case "fuel":
      if (meta.litersTotal != null && meta.fuelPrice != null) {
        return `${meta.litersTotal}L × ${meta.fuelPrice} EUR/L`;
      }
      return undefined;
    case "toll":
      if (meta.distanceKm != null) {
        return `${meta.distanceKm} km × stawka per kraj`;
      }
      return undefined;
    case "stops":
      if (meta.stopCount != null && meta.perStopCost != null) {
        return `${meta.stopCount} przystanków × ~${meta.perStopCost} EUR`;
      }
      return undefined;
    case "driver":
      if (meta.daysOnRoad != null && meta.dailyAllowance != null) {
        return `${meta.daysOnRoad} dni × ${meta.dailyAllowance} EUR/dzień`;
      }
      return undefined;
    case "maintenance":
      if (meta.distanceKm != null && meta.maintRate != null) {
        return `${meta.distanceKm} km × ${meta.maintRate} EUR/km`;
      }
      return undefined;
    default:
      return undefined;
  }
}

function buildWaterfallRows(data: ProfitBreakdownData): WaterfallRow[] {
  const rows: WaterfallRow[] = [];
  let cursor = data.revenueEur;

  rows.push({
    key: "revenue",
    label: "Przychód",
    bottom: 0,
    amount: data.revenueEur,
    range: toWaterfallRange(0, data.revenueEur),
    displayValue: data.revenueEur,
    barKind: "revenue",
  });

  const costItems: Array<{
    key: string;
    label: string;
    value: number;
    formulaKey: keyof ProfitBreakdownData["formulas"];
  }> = [
    { key: "fuel", label: "Paliwo", value: data.fuelEur, formulaKey: "fuel" },
    { key: "toll", label: "Myto", value: data.tollEur, formulaKey: "toll" },
    ...(data.stopCount >= 2
      ? [
          {
            key: "stops",
            label: "Przystanki",
            value: data.stopCostsEur,
            formulaKey: "stops" as const,
          },
        ]
      : []),
    {
      key: "driver",
      label: "Kierowca",
      value: data.driverEur,
      formulaKey: "driver",
    },
    {
      key: "maintenance",
      label: "Serwis",
      value: data.maintenanceEur,
      formulaKey: "maintenance",
    },
  ];

  for (const item of costItems) {
    cursor -= item.value;
    rows.push({
      key: item.key,
      label: item.label,
      bottom: cursor,
      amount: item.value,
      range: toWaterfallRange(cursor, item.value),
      displayValue: -item.value,
      barKind: "cost",
      formula: buildFormula(item.key, data.formulas[item.formulaKey]),
    });
  }

  const net = data.netProfitEur;
  rows.push({
    key: "profit",
    label: "Zysk netto",
    bottom: net >= 0 ? 0 : net,
    amount: Math.abs(net),
    range: toWaterfallRange(net >= 0 ? 0 : net, Math.abs(net)),
    displayValue: net,
    barKind: "profit",
  });

  return rows;
}

function buildLegChartRows(data: ProfitBreakdownData): WaterfallRow[] {
  const fuelFormula = buildFormula("fuel", data.formulas.fuel);

  return resolveLegRows(data).map((leg) => ({
    key: `leg-${leg.legId}`,
    label: formatLegLabel(leg.legId),
    bottom: 0,
    amount: leg.fuelConsumption,
    range: toWaterfallRange(0, leg.fuelConsumption),
    displayValue: leg.fuelConsumption,
    barKind: "cost",
    fill: COLOR_COST,
    valueUnit: "liters",
    formula: fuelFormula
      ? `${leg.fuelConsumption.toFixed(1)}L · ${data.formulas.fuel.fuelPrice ?? "?"} EUR/L`
      : `${leg.fuelConsumption.toFixed(1)}L`,
  }));
}

/**
 * Per-leg view: rozdziela kategorię „Paliwo” na Leg 1…N w miejscu na osi X,
 * reszta waterfall (Przychód, Myto, …) zostaje — płynne przejście wzdłuż X.
 */
function buildExpandedWaterfallRows(data: ProfitBreakdownData): WaterfallRow[] {
  const waterfall = buildWaterfallRows(data);
  const fuelIndex = waterfall.findIndex((row) => row.key === "fuel");
  if (fuelIndex === -1) {
    return buildLegChartRows(data);
  }

  const legs = resolveLegRows(data);
  const totalLiters =
    legs.reduce((sum, leg) => sum + leg.fuelConsumption, 0) || 1;
  const fuelFormula = buildFormula("fuel", data.formulas.fuel);

  let cursor = waterfall[fuelIndex].bottom + waterfall[fuelIndex].amount;

  const legRows: WaterfallRow[] = legs.map((leg) => {
    const share = (data.fuelEur * leg.fuelConsumption) / totalLiters;
    cursor -= share;
    return {
      key: `leg-${leg.legId}`,
      label: formatLegLabel(leg.legId),
      bottom: cursor,
      amount: share,
      range: toWaterfallRange(cursor, share),
      displayValue: -share,
      barKind: "cost",
      fill: COLOR_COST,
      valueUnit: "eur",
      formula: fuelFormula
        ? `${leg.fuelConsumption.toFixed(1)}L · ${data.formulas.fuel.fuelPrice ?? "?"} EUR/L`
        : `${leg.fuelConsumption.toFixed(1)}L`,
    };
  });

  const tail = waterfall.slice(fuelIndex + 1);
  const adjustedTail = tail.map((row) => {
    const nextBottom = cursor - row.amount;
    const next = {
      ...row,
      bottom: nextBottom,
      range: toWaterfallRange(nextBottom, row.amount),
    };
    cursor = nextBottom;
    return next;
  });

  return [...waterfall.slice(0, fuelIndex), ...legRows, ...adjustedTail];
}

function formatLiters(value: number): string {
  return `${value.toLocaleString("pl-PL", { maximumFractionDigits: 1 })} L`;
}

function countLoadedOffers(
  slots: Record<string, { offerId: string } | null>,
): number {
  const ids = new Set<string>();
  for (const pallet of Object.values(slots)) {
    if (pallet) {
      ids.add(pallet.offerId);
    }
  }
  return ids.size;
}

function findClientColorKey(
  summary: { offerId: string; name: string },
  slots: Record<
    string,
    { offerId: string; clientId: string; clientName: string } | null
  >,
): string {
  for (const pallet of Object.values(slots)) {
    if (
      pallet &&
      (pallet.clientName === summary.name || pallet.offerId === summary.offerId)
    ) {
      return pallet.clientId || pallet.offerId;
    }
  }
  return summary.offerId;
}

function buildClientSlices(
  clientSummary: ReturnType<typeof useClientSummary>,
  slots: Record<
    string,
    { offerId: string; clientId: string; clientName: string; ldm: number } | null
  >,
  data: ProfitBreakdownData,
  isDark: boolean,
): ClientRevenueSlice[] {
  const revenueByOffer = new Map(
    data.offerRevenue.map((row) => [row.offerId, row.revenueEur]),
  );

  if (clientSummary.length > 0) {
    return clientSummary.map((client) => {
      const colorKey = findClientColorKey(client, slots);

      let revenue = 0;
      if (data.fromApi && revenueByOffer.size > 0) {
        for (const pallet of Object.values(slots)) {
          if (!pallet) continue;
          if (
            pallet.clientId === colorKey ||
            pallet.clientName === client.name ||
            pallet.offerId === client.offerId
          ) {
            revenue += revenueByOffer.get(pallet.offerId) ?? 0;
          }
        }
      } else {
        for (const pallet of Object.values(slots)) {
          if (!pallet) continue;
          if (
            pallet.clientId === colorKey ||
            pallet.clientName === client.name
          ) {
            revenue += Math.round(pallet.ldm * 187.5);
          }
        }
      }

      return {
        clientId: colorKey,
        name: client.name,
        revenue,
        fill: getCompanyColorHex(colorKey, isDark),
      };
    });
  }

  return [];
}

function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

// ─── Custom tooltip ──────────────────────────────────────────────────────────

interface TooltipPayloadItem {
  payload?: WaterfallRow;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }

  const row = payload[0]?.payload;
  if (!row) {
    return null;
  }

  return (
    <div className="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-[var(--ui-text-primary)]">{row.label}</p>
      <p className="mt-0.5 font-medium text-[var(--ui-text-primary)]">
        {row.valueUnit === "liters"
          ? formatLiters(row.displayValue)
          : formatEur(row.displayValue, row.barKind !== "cost")}
      </p>
      {row.formula ? (
        <p className="mt-1 font-mono text-[10px] text-[var(--ui-text-secondary)]">
          {row.formula}
        </p>
      ) : null}
    </div>
  );
}

interface PieTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: ClientRevenueSlice }>;
}

function PieTooltip({ active, payload }: PieTooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }

  const slice = payload[0]?.payload;
  if (!slice) {
    return null;
  }

  return (
    <div className="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-[var(--ui-text-primary)]">{slice.name}</p>
      <p className="mt-0.5 text-[var(--ui-text-secondary)]">
        {formatEur(slice.revenue)}
      </p>
    </div>
  );
}

function WaterfallBarLabel(props: {
  x?: number;
  y?: number;
  width?: number;
  payload?: WaterfallRow;
}) {
  const { x = 0, y = 0, width = 0, payload } = props;
  if (!payload) {
    return null;
  }

  const text =
    payload.valueUnit === "liters"
      ? formatLiters(payload.displayValue)
      : payload.barKind === "cost"
        ? formatEur(payload.displayValue)
        : formatEur(payload.displayValue, true);

  return (
    <text
      x={x + width / 2}
      y={y - 6}
      fill="currentColor"
      className="fill-[var(--ui-text-primary)]"
      textAnchor="middle"
      fontSize={10}
    >
      {text}
    </text>
  );
}

function EmptyState() {
  return (
    <section
      className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--ui-border)] bg-[var(--ui-surface)] px-6 py-10 text-center"
      aria-label="Brak danych analitycznych"
    >
      <p className="text-sm font-medium text-[var(--ui-text-primary)]">
        Dodaj ładunki, aby zobaczyć kalkulacje
      </p>
      <p className="mt-1 max-w-sm text-xs text-[var(--ui-text-secondary)]">
        Wykres zysków i udział klientów pojawi się po załadowaniu co najmniej
        jednej oferty do sesji.
      </p>
    </section>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function ProfitWaterfall({ data: dataOverride }: ProfitWaterfallProps = {}) {
  const hydrated = useClientHydrated();
  const { slots, sessionId } = useLoadStore(
    useShallow((state) => ({ slots: state.slots, sessionId: state.sessionId })),
  );
  const clientSummary = useClientSummary();
  const isDark = useIsDarkMode();
  const [perLegView, setPerLegView] = useState(false);

  const {
    data: sessionData,
    loading,
    error,
    isDemoFallback,
  } = useProfitBreakdown(dataOverride ? null : sessionId);

  const data = dataOverride ?? sessionData;

  const offerCount = useMemo(() => countLoadedOffers(slots), [slots]);
  const waterfallRows = useMemo(() => buildWaterfallRows(data), [data]);
  const expandedRows = useMemo(() => buildExpandedWaterfallRows(data), [data]);
  const chartRows = perLegView ? expandedRows : waterfallRows;

  const clientSlices = useMemo(
    () => buildClientSlices(clientSummary, slots, data, isDark),
    [clientSummary, slots, data, isDark],
  );

  const yMax = useMemo(() => {
    const peak = Math.max(
      data.revenueEur,
      ...waterfallRows.map((row) => row.bottom + row.amount),
      ...expandedRows.map((row) => row.bottom + row.amount),
    );
    return Math.ceil((peak * 1.12) / 100) * 100;
  }, [data.revenueEur, waterfallRows, expandedRows]);

  const yMin = useMemo(() => {
    const floor = Math.min(
      0,
      ...waterfallRows.map((row) => row.bottom),
      data.netProfitEur,
    );
    return floor < 0 ? Math.floor((floor * 1.12) / 100) * 100 : 0;
  }, [waterfallRows, data.netProfitEur]);

  if (!hydrated) {
    return (
      <section
        className="flex min-h-[220px] items-center justify-center rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4"
        aria-hidden
      >
        <p className="text-sm text-[var(--ui-text-secondary)]">Wczytywanie…</p>
      </section>
    );
  }

  if (offerCount === 0) {
    return <EmptyState />;
  }

  return (
    <section
      className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4"
      aria-label="Analityka zysku sesji"
      aria-busy={loading}
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ui-text-primary)]">
            Kalkulacja zysku
          </h2>
          <p className="text-xs text-[var(--ui-text-secondary)]">
            {perLegView
              ? `Rozbicie paliwa per odcinek (${resolveLegRows(data).length}) — ta sama skala EUR`
              : "Waterfall kosztów i zysku netto"}
            {isDemoFallback && !dataOverride ? " · dane demonstracyjne" : null}
          </p>
          {error ? (
            <p className="mt-1 text-xs text-[var(--ui-danger,#dc2f2f)]">{error}</p>
          ) : null}
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--ui-text-secondary)]">
          <span>Widok per odcinek</span>
          <button
            type="button"
            role="switch"
            aria-checked={perLegView}
            onClick={() => setPerLegView((prev) => !prev)}
            className={`relative h-6 w-11 rounded-full transition-colors duration-300 ${
              perLegView ? "bg-[#534AB7]" : "bg-[var(--ui-border)]"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-300 ${
                perLegView ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </label>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-h-[240px]">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={chartRows}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={isDark ? "#263044" : "#e5e7eb"}
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fill: isDark ? "#94a3b8" : "#64748b", fontSize: 11 }}
                interval={0}
                angle={-18}
                textAnchor="end"
                height={52}
              />
              <YAxis
                domain={[yMin, yMax]}
                tick={{ fill: isDark ? "#94a3b8" : "#64748b", fontSize: 11 }}
                width={48}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "transparent" }} />
              <Bar
                dataKey="range"
                radius={[3, 3, 0, 0]}
                isAnimationActive
                animationDuration={400}
                animationEasing="ease-in-out"
              >
                {!perLegView ? <LabelList content={<WaterfallBarLabel />} /> : null}
                {chartRows.map((row) => (
                  <Cell
                    key={row.key}
                    fill={row.fill ?? getBarColor(row.barKind, row.displayValue)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {clientSlices.length > 0 ? (
          <aside className="flex flex-col">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ui-text-secondary)]">
              Przychód per klient
            </h3>
            <div className="min-h-[200px] flex-1">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={clientSlices}
                    dataKey="revenue"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={42}
                    outerRadius={72}
                    paddingAngle={2}
                    animationDuration={400}
                  >
                    {clientSlices.map((slice) => (
                      <Cell key={slice.clientId} fill={slice.fill} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-1 space-y-1">
              {clientSlices.map((slice) => (
                <li
                  key={slice.clientId}
                  className="flex items-center justify-between gap-2 text-[11px] text-[var(--ui-text-secondary)]"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: slice.fill }}
                      aria-hidden
                    />
                    <span className="truncate">{slice.name}</span>
                  </span>
                  <span className="shrink-0 font-medium text-[var(--ui-text-primary)]">
                    {formatEur(slice.revenue)}
                  </span>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

export type { ProfitBreakdownData } from "@/lib/api/profitClient";
