"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { DriverRouteBriefing } from "@/components/driver/DriverRouteBriefing";
import { fetchSessionDetail, type SessionDetailResponse } from "@/lib/api/sessionClient";

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const [session, setSession] = useState<SessionDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetchSessionDetail(params.id)
      .then((detail) => {
        if (!cancelled) {
          setSession(detail);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Nie udało się wczytać sesji.");
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
  }, [params.id]);

  if (loading) {
    return <p className="text-sm text-[var(--ui-text-secondary)]">Wczytywanie sesji…</p>;
  }

  if (error || !session) {
    return (
      <p className="text-sm text-[var(--ui-error)]" role="alert">
        {error ?? "Sesja nie istnieje."}
      </p>
    );
  }

  return (
    <section className="grid gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Sesja {session.id.slice(0, 8)}…</h1>
          <p className="text-sm text-[var(--ui-text-secondary)]">
            Utworzono: {new Date(session.created_at).toLocaleString("pl-PL")}
          </p>
        </div>
        <Badge variant={session.status === "confirmed" ? "success" : "info"}>
          {session.status}
        </Badge>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardTitle>Oferty</CardTitle>
          <CardDescription>{session.metrics.client_count}</CardDescription>
        </Card>
        <Card>
          <CardTitle>Postoje</CardTitle>
          <CardDescription>{session.metrics.stop_count}</CardDescription>
        </Card>
        <Card>
          <CardTitle>Szacowany zysk</CardTitle>
          <CardDescription>
            {session.metrics.estimated_net_profit_eur != null
              ? `${session.metrics.estimated_net_profit_eur.toLocaleString("pl-PL")} EUR`
              : "—"}
          </CardDescription>
        </Card>
      </div>

      <Card>
        <CardTitle>Szczegóły</CardTitle>
        <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <div>
            <dt className="text-[var(--ui-text-secondary)]">Pojazd</dt>
            <dd>{session.vehicle.name}</dd>
          </div>
          <div>
            <dt className="text-[var(--ui-text-secondary)]">Kierowca</dt>
            <dd>{session.driver_profile.name}</dd>
          </div>
          <div>
            <dt className="text-[var(--ui-text-secondary)]">Wypełnienie LDM</dt>
            <dd>{session.metrics.fill_pct.toFixed(1)}%</dd>
          </div>
          <div>
            <dt className="text-[var(--ui-text-secondary)]">Dystans</dt>
            <dd>{session.metrics.total_distance_km.toFixed(1)} km</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardTitle>Plan dla kierowcy</CardTitle>
        <CardDescription>
          Podsumowanie trasy z GPS, ETA i linkami do map — gotowe do wysłania.
        </CardDescription>
        <div className="mt-3">
          <DriverRouteBriefing sessionId={session.id} variant="full" />
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Link href={`/sessions/${session.id}/map`}>
          <Button variant="secondary">Mapa trasy</Button>
        </Link>
        <Link href="/planner">
          <Button variant="primary">Otwórz w plannerze</Button>
        </Link>
      </div>
    </section>
  );
}
