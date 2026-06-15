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
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type RectangleProps,
} from "recharts";
import { useShallow } from "zustand/shallow";

import { useClientHydrated } from "@/hooks/useClientHydrated";
import { useProfitBreakdown } from "@/hooks/useProfitBreakdown";
import type { ProfitBreakdownData } from "@/lib/api/profitClient";
import {
  buildClientPieData,
  formatPieTooltipValue,
  type ClientPieSlice,
} from "@/lib/analytics/buildClientPieData";
import {
  buildWaterfallData,
  formatEur,
  getWaterfallYDomain,
  type WaterfallBarRow,
} from "@/lib/analytics/buildWaterfallData";
import { useClientSummary, useLoadStore } from "@/lib/stores/loadStore";

export interface ProfitWaterfallProps {
  /** Optional override for tests or storybook; skips live API fetch. */
  data?: ProfitBreakdownData;
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

interface TooltipPayloadItem {
  payload?: WaterfallBarRow;
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

  const signed =
    row.barKind === "profit" || (row.barKind === "revenue" && row.displayValue > 0);

  return (
    <div className="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-[var(--ui-text-primary)]">{row.label}</p>
      <p className="mt-0.5 font-medium text-[var(--ui-text-primary)]">
        {formatEur(row.displayValue, signed)}
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
  payload?: Array<{ payload?: ClientPieSlice }>;
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
        {formatPieTooltipValue(slice)}
      </p>
    </div>
  );
}

function WaterfallBarLabel(props: {
  x?: number;
  y?: number;
  width?: number;
  payload?: WaterfallBarRow;
}) {
  const { x = 0, y = 0, width = 0, payload } = props;
  if (!payload) {
    return null;
  }

  const text =
    payload.barKind === "cost"
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

function WaterfallBarShape(props: RectangleProps & { payload?: WaterfallBarRow }) {
  const { payload, ...rectProps } = props;
  return (
    <g data-testid="waterfall-bar" data-bar-key={payload?.key}>
      <Rectangle {...rectProps} fill={payload?.fill ?? rectProps.fill} />
    </g>
  );
}

function EmptyState() {
  return (
    <section
      className="profit-waterfall profit-waterfall--empty"
      aria-label="Brak danych kalkulacji"
    >
      <p className="profit-waterfall__empty-text">
        Dodaj ładunki, aby zobaczyć kalkulację
      </p>
    </section>
  );
}

export function ProfitWaterfall({ data: dataOverride }: ProfitWaterfallProps = {}) {
  const hydrated = useClientHydrated();
  const isDark = useIsDarkMode();
  const { slots, sessionId } = useLoadStore(
    useShallow((state) => ({ slots: state.slots, sessionId: state.sessionId })),
  );
  const clientSummary = useClientSummary();

  const {
    data: sessionData,
    loading,
    error,
  } = useProfitBreakdown(dataOverride ? null : sessionId);

  const data = dataOverride ?? sessionData;
  const offerCount = useMemo(() => countLoadedOffers(slots), [slots]);

  const chartRows = useMemo(
    () => (data ? buildWaterfallData(data) : []),
    [data],
  );

  const clientSlices = useMemo(
    () => buildClientPieData(clientSummary, slots, data ?? undefined, isDark),
    [clientSummary, slots, data, isDark],
  );

  const { yMin, yMax } = useMemo(() => {
    if (!data) {
      return { yMin: 0, yMax: 100 };
    }
    return getWaterfallYDomain(chartRows, data.revenueEur, data.netProfitEur);
  }, [chartRows, data]);

  const gridStroke = isDark ? "#263044" : "#e5e7eb";
  const tickFill = isDark ? "#94a3b8" : "#64748b";

  if (!hydrated) {
    return (
      <section className="profit-waterfall" aria-hidden>
        <p className="profit-waterfall__empty-text">Wczytywanie…</p>
      </section>
    );
  }

  if (offerCount === 0) {
    return <EmptyState />;
  }

  if (loading) {
    return (
      <section className="profit-waterfall" aria-label="Wczytywanie kalkulacji">
        <p className="profit-waterfall__empty-text">Wczytywanie kalkulacji…</p>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="profit-waterfall profit-waterfall--empty" aria-label="Brak danych">
        {error ? (
          <p className="profit-waterfall__empty-text profit-waterfall__empty-text--error">
            {error}
          </p>
        ) : (
          <p className="profit-waterfall__empty-text">
            Zoptymalizuj trasę, aby zobaczyć kalkulację zysku.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="profit-waterfall" aria-label="Podsumowanie finansowe">
      <div className="profit-waterfall__layout">
        <div className="profit-waterfall__chart">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={chartRows}
              margin={{ top: 20, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: tickFill, fontSize: 11 }}
                interval={0}
                angle={-18}
                textAnchor="end"
                height={52}
              />
              <YAxis
                domain={[yMin, yMax]}
                tick={{ fill: tickFill, fontSize: 11 }}
                width={48}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "transparent" }} />
              <Bar
                dataKey="range"
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
                shape={WaterfallBarShape}
              >
                <LabelList content={<WaterfallBarLabel />} />
                {chartRows.map((row) => (
                  <Cell key={row.key} fill={row.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {clientSlices.length > 0 ? (
          <aside className="profit-waterfall__pie" aria-label="Udział klientów w ładunku">
            <h3 className="profit-waterfall__pie-title">Udział klientów</h3>
            <div className="profit-waterfall__pie-chart">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={clientSlices}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={68}
                    paddingAngle={2}
                    isAnimationActive={false}
                  >
                    {clientSlices.map((slice) => (
                      <Cell key={slice.clientId} fill={slice.fill} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="profit-waterfall__pie-legend">
              {clientSlices.map((slice) => (
                <li key={slice.clientId} className="profit-waterfall__pie-legend-item">
                  <span className="profit-waterfall__pie-legend-label">
                    <span
                      className="profit-waterfall__pie-swatch"
                      style={{ backgroundColor: slice.fill }}
                      aria-hidden
                    />
                    <span className="profit-waterfall__pie-name">{slice.name}</span>
                  </span>
                  <span className="profit-waterfall__pie-value">
                    {slice.valueSource === "revenue"
                      ? formatEur(slice.value)
                      : formatPieTooltipValue(slice)}
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
