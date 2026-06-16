"use client";

/**
 * Analytics — session profit waterfall, weekly revenue and fill-rate trend.
 * Replaces the old `/analytics → /` redirect (UX-01).
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type RectangleProps,
} from "recharts";
import { Rectangle } from "recharts";
import { BarChart3 } from "lucide-react";

import { Card } from "@/components/loadmax/ui";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  fetchDashboard,
  type DashboardResponse,
  type DashboardSessionSummary,
} from "@/lib/api/dashboardClient";
import { fetchSessionDetail, type SessionDetailResponse } from "@/lib/api/sessionClient";
import {
  fetchSessionProfit,
  type ProfitBreakdownData,
} from "@/lib/api/profitClient";
import {
  buildWaterfallData,
  formatEur,
  getWaterfallYDomain,
  type WaterfallBarRow,
} from "@/lib/analytics/buildWaterfallData";

const TICK_FILL = "#64748b";
const GRID_STROKE = "#e5e7eb";

// ─── Waterfall (Section 1) ────────────────────────────────────────────────────

function WaterfallBarShape(props: RectangleProps & { payload?: WaterfallBarRow }) {
  const { payload, ...rect } = props;
  return (
    <g data-testid="waterfall-bar" data-bar-key={payload?.key}>
      <Rectangle {...rect} fill={payload?.fill ?? rect.fill} />
    </g>
  );
}

interface WaterfallTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: WaterfallBarRow }>;
}

function WaterfallTooltip({ active, payload }: WaterfallTooltipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-ui-border bg-ui-surface px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-ui-primary">{row.label}</p>
      <p className="mt-0.5 text-ui-primary">
        {formatEur(row.displayValue, row.barKind !== "cost")}
      </p>
      {row.formula ? (
        <p className="mt-1 font-mono text-[10px] text-ui-secondary">{row.formula}</p>
      ) : null}
    </div>
  );
}

function SessionWaterfall({ data }: { data: ProfitBreakdownData }) {
  const rows = useMemo(() => buildWaterfallData(data), [data]);
  const { yMin, yMax } = useMemo(
    () => getWaterfallYDomain(rows, data.revenueEur, data.netProfitEur),
    [rows, data],
  );

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={rows} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: TICK_FILL, fontSize: 11 }}
          interval={0}
          angle={-18}
          textAnchor="end"
          height={52}
        />
        <YAxis domain={[yMin, yMax]} tick={{ fill: TICK_FILL, fontSize: 11 }} width={56} />
        <Tooltip content={<WaterfallTooltip />} cursor={{ fill: "transparent" }} />
        <Bar dataKey="range" radius={[3, 3, 0, 0]} shape={WaterfallBarShape}>
          {rows.map((row) => (
            <Cell key={row.key} fill={row.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Trend data helpers ───────────────────────────────────────────────────────

interface SessionPoint {
  id: string;
  createdAt: string;
  label: string;
  netProfitEur: number;
  fillPct: number;
}

function isoWeekKey(date: Date): string {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (tmp.getUTCDay() + 6) % 7;
  tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((tmp.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${tmp.getUTCFullYear()}-T${String(week).padStart(2, "0")}`;
}

function buildWeeklyRevenue(points: SessionPoint[]): Array<{ label: string; revenue: number }> {
  const byWeek = new Map<string, number>();
  for (const point of points) {
    const key = isoWeekKey(new Date(point.createdAt));
    byWeek.set(key, (byWeek.get(key) ?? 0) + point.netProfitEur);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, revenue]) => ({ label, revenue: Math.round(revenue) }));
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<AnalyticsSkeleton />}>
      <AnalyticsInner />
    </Suspense>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Card className="h-[320px] animate-pulse bg-ui-raised" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="h-[260px] animate-pulse bg-ui-raised" />
        <Card className="h-[260px] animate-pulse bg-ui-raised" />
      </div>
    </div>
  );
}

function AnalyticsInner() {
  const searchParams = useSearchParams();
  const querySession = searchParams.get("session");

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [points, setPoints] = useState<SessionPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profit, setProfit] = useState<ProfitBreakdownData | null>(null);
  const [profitLoading, setProfitLoading] = useState(false);
  const [profitError, setProfitError] = useState<string | null>(null);

  // Load dashboard + per-session metrics for the trend charts.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchDashboard();
        if (cancelled) return;
        setDashboard(response);

        const recent = response.recent_sessions.slice(0, 7);
        const details = await Promise.all(
          recent.map((s: DashboardSessionSummary) =>
            fetchSessionDetail(s.id)
              .then((detail): SessionPoint => ({
                id: detail.id,
                createdAt: detail.created_at,
                label: new Date(detail.created_at).toLocaleDateString("pl-PL", {
                  day: "2-digit",
                  month: "2-digit",
                }),
                netProfitEur: detail.metrics.estimated_net_profit_eur ?? 0,
                fillPct: detail.metrics.fill_pct,
              }))
              .catch(() => null),
          ),
        );
        if (cancelled) return;
        const valid = details.filter((d): d is SessionPoint => d !== null);
        valid.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        setPoints(valid);

        const initial = querySession ?? response.recent_sessions[0]?.id ?? null;
        setSelectedId((current) => current ?? initial);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Nie udało się wczytać analityki.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [querySession]);

  // Load profit breakdown for the selected session.
  useEffect(() => {
    if (!selectedId) {
      setProfit(null);
      return;
    }
    let cancelled = false;
    setProfitLoading(true);
    setProfitError(null);
    void fetchSessionProfit(selectedId)
      .then((data) => {
        if (!cancelled) setProfit(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setProfit(null);
        setProfitError(
          err instanceof Error ? err.message : "Brak danych zysku dla tej sesji.",
        );
      })
      .finally(() => {
        if (!cancelled) setProfitLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const weekly = useMemo(() => buildWeeklyRevenue(points), [points]);
  const weeklyMax = useMemo(() => Math.max(0, ...weekly.map((w) => w.revenue)), [weekly]);
  const sessions = dashboard?.recent_sessions ?? [];

  if (loading) {
    return <AnalyticsSkeleton />;
  }

  if (error) {
    return (
      <p className="text-sm text-ui-error" role="alert">
        {error}
      </p>
    );
  }

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Brak danych do analizy"
        description="Zaplanuj i zoptymalizuj trasę, aby zobaczyć waterfall zysku oraz trendy tygodniowe."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Section 1: Session Profit Waterfall ───────────────────── */}
      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ui-primary">Profit waterfall</h2>
            <p className="text-xs text-ui-secondary">
              Wybierz sesję, aby zobaczyć rozbicie przychodów i kosztów.
            </p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {sessions.slice(0, 8).map((session) => {
            const active = session.id === selectedId;
            return (
              <button
                key={session.id}
                type="button"
                data-testid="analytics-session-btn"
                onClick={() => setSelectedId(session.id)}
                className={[
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-ui-accent bg-ui-accent/10 text-ui-accent"
                    : "border-ui-border bg-ui-surface text-ui-secondary hover:bg-ui-raised",
                ].join(" ")}
              >
                {session.vehicle_name ?? "Sesja"} · {session.id.slice(0, 6)}
              </button>
            );
          })}
        </div>

        {profitLoading ? (
          <div className="h-[260px] animate-pulse rounded-xl bg-ui-raised" />
        ) : profit ? (
          <SessionWaterfall data={profit} />
        ) : (
          <EmptyState
            icon={BarChart3}
            title="Brak kalkulacji zysku"
            description={
              profitError ??
              "Ta sesja nie ma jeszcze trasy — zoptymalizuj ją w Planning lab."
            }
          />
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Section 2: Weekly Revenue ──────────────────────────── */}
        <Card className="p-5">
          <h2 className="text-base font-semibold text-ui-primary">Tygodniowy zysk netto</h2>
          <p className="mb-3 text-xs text-ui-secondary">
            Suma szacowanego zysku netto sesji per tydzień.
          </p>
          {weekly.length === 0 ? (
            <EmptyState title="Brak danych tygodniowych" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weekly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: TICK_FILL, fontSize: 11 }} />
                <YAxis tick={{ fill: TICK_FILL, fontSize: 11 }} width={56} />
                <Tooltip cursor={{ fill: "transparent" }} />
                <Bar dataKey="revenue" radius={[6, 6, 0, 0]}>
                  {weekly.map((week) => (
                    <Cell
                      key={week.label}
                      fill={week.revenue >= weeklyMax && weeklyMax > 0 ? "#1a38f5" : "#cbd5e1"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* ── Section 3: Fill Rate Trend ─────────────────────────── */}
        <Card className="p-5">
          <h2 className="text-base font-semibold text-ui-primary">Trend wypełnienia (LFIL)</h2>
          <p className="mb-3 text-xs text-ui-secondary">
            Średnie wypełnienie ostatnich {points.length} sesji.
          </p>
          {points.length === 0 ? (
            <EmptyState title="Brak danych wypełnienia" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart
                data={points.map((p) => ({ label: p.label, fill: Math.round(p.fillPct) }))}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: TICK_FILL, fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fill: TICK_FILL, fontSize: 11 }} width={40} />
                <Tooltip cursor={{ stroke: "transparent" }} />
                <Line
                  type="monotone"
                  dataKey="fill"
                  stroke="#534AB7"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>
    </div>
  );
}
