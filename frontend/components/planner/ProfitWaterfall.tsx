"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
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
  buildWaterfallData,
  formatEur,
  getWaterfallYDomain,
  type WaterfallBarRow,
} from "@/lib/analytics/buildWaterfallData";
import { useLoadStore } from "@/lib/stores/loadStore";

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
  const { slots, sessionId } = useLoadStore(
    useShallow((state) => ({ slots: state.slots, sessionId: state.sessionId })),
  );

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

  const { yMin, yMax } = useMemo(() => {
    if (!data) {
      return { yMin: 0, yMax: 100 };
    }
    return getWaterfallYDomain(chartRows, data.revenueEur, data.netProfitEur);
  }, [chartRows, data]);

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
      <div className="profit-waterfall__chart">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={chartRows}
            margin={{ top: 20, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "#64748b", fontSize: 11 }}
              interval={0}
              angle={-18}
              textAnchor="end"
              height={52}
            />
            <YAxis
              domain={[yMin, yMax]}
              tick={{ fill: "#64748b", fontSize: 11 }}
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
    </section>
  );
}
