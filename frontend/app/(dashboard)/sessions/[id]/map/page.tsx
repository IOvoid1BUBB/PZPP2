"use client";

import { useParams } from "next/navigation";

import { Card, CardDescription, CardTitle } from "@/components/ui/Card";

export default function SessionMapPage() {
  const params = useParams<{ id: string }>();

  return (
    <section className="grid gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Route Map</h1>
        <p className="text-sm text-[var(--ui-text-secondary)]">
          Sesja: {params.id}
        </p>
      </header>

      <Card className="p-0">
        <div className="grid min-h-[420px] place-items-center rounded-lg border-2 border-dashed border-[var(--ui-border)] bg-[var(--ui-surface-raised)]">
          <div className="text-center">
            <CardTitle>Mapa trasy</CardTitle>
            <CardDescription>
              Placeholder pod widok mapy (Leaflet / OSRM).
            </CardDescription>
          </div>
        </div>
      </Card>
    </section>
  );
}
