"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { fetchDashboard, type DashboardResponse } from "@/lib/api/dashboardClient";

export default function AnalyticsPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetchDashboard()
      .then((response) => {
        if (!cancelled) {
          setData(response);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Nie udało się wczytać dashboardu.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className="text-sm text-[var(--ui-text-secondary)]">Wczytywanie KPI…</p>;
  }

  if (error || !data) {
    return (
      <p className="text-sm text-[var(--ui-error)]" role="alert">
        {error ?? "Brak danych dashboardu."}
      </p>
    );
  }

  const kpis = [
    {
      label: "Szacowany zysk",
      value: `${data.kpis.total_estimated_profit_eur.toLocaleString("pl-PL")} EUR`,
      tone: "green" as const,
      progress: Math.min(100, Math.max(0, data.kpis.total_estimated_profit_eur / 500)),
    },
    {
      label: "Aktywne sesje",
      value: String(data.kpis.active_sessions),
      tone: "amber" as const,
      progress: Math.min(
        100,
        data.kpis.total_sessions > 0
          ? (data.kpis.active_sessions / data.kpis.total_sessions) * 100
          : 0,
      ),
    },
    {
      label: "Średnie wypełnienie",
      value: `${data.kpis.average_fill_pct.toFixed(1)}%`,
      tone: "red" as const,
      progress: Math.min(100, data.kpis.average_fill_pct),
    },
  ];

  return (
    <section className="grid gap-4">
      <header className="mb-2">
        <h1 className="text-2xl font-semibold">Profit Dashboard</h1>
        <p className="text-sm text-[var(--ui-text-secondary)]">
          Operacyjne KPI z backendu (`GET /api/v1/dashboard`).
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {kpis.map((item) => (
          <Card key={item.label}>
            <div className="mb-2 flex items-center justify-between">
              <CardTitle>{item.label}</CardTitle>
              <Badge
                variant={
                  item.tone === "green"
                    ? "success"
                    : item.tone === "amber"
                      ? "warning"
                      : "danger"
                }
              >
                Live
              </Badge>
            </div>
            <p className="mb-3 text-lg font-semibold text-[var(--ui-text-primary)]">
              {item.value}
            </p>
            <ProgressBar value={item.progress} tone={item.tone} />
          </Card>
        ))}
      </div>

      <Card>
        <CardTitle>Ostatnie sesje</CardTitle>
        <CardDescription>
          Oferty rynkowe w bazie: {data.kpis.market_offers_count}
        </CardDescription>
        {data.recent_sessions.length === 0 ? (
          <p className="text-sm text-[var(--ui-text-secondary)]">Brak sesji w systemie.</p>
        ) : (
          <ul className="grid gap-2">
            {data.recent_sessions.map((session) => (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--ui-border)] px-3 py-2 text-sm"
              >
                <div>
                  <Link href={`/sessions/${session.id}`} className="font-medium underline">
                    {session.id.slice(0, 8)}…
                  </Link>
                  <span className="ml-2 text-[var(--ui-text-secondary)]">
                    {session.vehicle_name ?? "—"} · {session.offer_count} ofert ·{" "}
                    {session.stop_count} postojów
                  </span>
                </div>
                <Badge variant="info">{session.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
