"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { type Session } from "@/lib/types/sessions";

function getMockSession(id: string): Session {
  return {
    id,
    status: "running",
    createdAt: new Date().toISOString(),
    plannedStops: 12,
    assignedOffers: 37,
    expectedProfitEur: 21400,
  };
}

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const session = getMockSession(params.id);

  return (
    <section className="grid gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Sesja {session.id}</h1>
          <p className="text-sm text-[var(--ui-text-secondary)]">
            Główny widok sesji konsolidacji.
          </p>
        </div>
        <Badge variant={session.status === "completed" ? "success" : "info"}>
          {session.status}
        </Badge>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardTitle>Assigned Offers</CardTitle>
          <CardDescription>{session.assignedOffers}</CardDescription>
        </Card>
        <Card>
          <CardTitle>Planned Stops</CardTitle>
          <CardDescription>{session.plannedStops}</CardDescription>
        </Card>
        <Card>
          <CardTitle>Expected Profit</CardTitle>
          <CardDescription>
            {session.expectedProfitEur.toLocaleString("pl-PL")} EUR
          </CardDescription>
        </Card>
      </div>

      <div>
        <Link href={`/sessions/${session.id}/map`}>
          <Button variant="secondary">Mapa trasy</Button>
        </Link>
      </div>
    </section>
  );
}
