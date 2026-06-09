"use client";

import { useEffect, useState } from "react";

import { Card, CardTitle } from "@/components/ui/Card";
import { fetchFleetOverview } from "@/lib/api/fleetClient";
import type { DriverProfileRecord } from "@/lib/api/sessionClient";
import type { VehicleConfig } from "@/lib/types/load";

export default function FleetPage() {
  const [vehicles, setVehicles] = useState<VehicleConfig[]>([]);
  const [driverProfiles, setDriverProfiles] = useState<DriverProfileRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetchFleetOverview()
      .then((overview) => {
        if (!cancelled) {
          setVehicles(overview.vehicles);
          setDriverProfiles(overview.driverProfiles);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Nie udało się wczytać floty.");
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
    return <p className="text-sm text-[var(--ui-text-secondary)]">Wczytywanie floty…</p>;
  }

  if (error) {
    return (
      <p className="text-sm text-[var(--ui-error)]" role="alert">
        {error}
      </p>
    );
  }

  return (
    <section className="grid gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Fleet Manager</h1>
        <p className="text-sm text-[var(--ui-text-secondary)]">
          Katalog pojazdów i profili kosztowych kierowców (odczyt z API).
        </p>
      </header>

      <Card>
        <CardTitle>Pojazdy ({vehicles.length})</CardTitle>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--ui-border)]">
                <th className="px-2 py-2">Nazwa</th>
                <th className="px-2 py-2">Typ</th>
                <th className="px-2 py-2">Max LDM</th>
                <th className="px-2 py-2">Max kg</th>
                <th className="px-2 py-2">Przystanki</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((vehicle) => (
                <tr key={vehicle.id} className="border-b border-[var(--ui-border)]">
                  <td className="px-2 py-2">{vehicle.name}</td>
                  <td className="px-2 py-2">{vehicle.type}</td>
                  <td className="px-2 py-2">{vehicle.maxLdm}</td>
                  <td className="px-2 py-2">{vehicle.maxWeightKg}</td>
                  <td className="px-2 py-2">{vehicle.maxStops}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardTitle>Profile kierowców ({driverProfiles.length})</CardTitle>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--ui-border)]">
                <th className="px-2 py-2">Kod</th>
                <th className="px-2 py-2">Nazwa</th>
                <th className="px-2 py-2">EUR/h</th>
                <th className="px-2 py-2">Paliwo jałowe l/h</th>
                <th className="px-2 py-2">Opłata admin EUR</th>
              </tr>
            </thead>
            <tbody>
              {driverProfiles.map((profile) => (
                <tr key={profile.id} className="border-b border-[var(--ui-border)]">
                  <td className="px-2 py-2">{profile.code}</td>
                  <td className="px-2 py-2">{profile.name}</td>
                  <td className="px-2 py-2">{profile.hourly_cost_eur}</td>
                  <td className="px-2 py-2">{profile.idle_fuel_l_per_hour}</td>
                  <td className="px-2 py-2">{profile.stop_admin_fee_eur}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-[var(--ui-text-secondary)]">
          Edycja katalogów wymaga rozszerzenia API (PATCH) — obecnie dane są seedowane w migracjach.
        </p>
      </Card>
    </section>
  );
}
