"use client";

import { Suspense } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Banknote,
  Fuel,
  IdCard,
  MapPin,
  MoreVertical,
  Navigation,
  Plus,
  RotateCcw,
  Ruler,
  Truck,
  User,
  Weight,
} from "lucide-react";
import { Marker } from "react-simple-maps";

import { Card, ProgressBar } from "@/components/loadmax/ui";
import { EuropeMap } from "@/components/loadmax/EuropeMap";
import { SquareMarker } from "@/components/loadmax/MapMarkers";
import { TruckIllustration } from "@/components/loadmax/TruckIllustration";
import { SegmentedToggle } from "@/components/loadmax/SegmentedToggle";
import { useToast } from "@/components/ui/Toast";
import {
  fetchDashboard,
  type DashboardSessionSummary,
} from "@/lib/api/dashboardClient";
import {
  createSession,
  fetchDriverProfiles,
  fetchSessionDetail,
  fetchVehicles,
  type DriverProfileRecord,
  type SessionDetailResponse,
} from "@/lib/api/sessionClient";
import { useSessionStore } from "@/lib/stores/sessionStore";
import type { VehicleConfig } from "@/lib/types/load";
import { cn } from "@/lib/utils";

const WARSAW: [number, number] = [21.01, 52.22];
const TABS = ["Vehicles", "Drivers"] as const;
type Tab = (typeof TABS)[number];

function StatRow({
  icon: Icon,
  children,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-ui-secondary">
      <Icon className="size-4 text-ui-muted" aria-hidden="true" />
      {children}
    </div>
  );
}

function RouteStatsCard({ detail }: { detail: SessionDetailResponse | null }) {
  const fill = detail ? detail.metrics.fill_pct : 0;
  const emptyRuns = detail ? Math.max(0, 100 - fill) : 0;
  return (
    <Card className="border-0 p-6 shadow-none">
      <h3 className="text-base font-semibold text-ui-primary">Route stats</h3>
      {detail ? (
        <>
          <div className="mt-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-ui-muted">Session status</p>
              <p className="mt-1 text-sm font-medium text-ui-primary">
                {detail.status}
              </p>
            </div>
            <div className="min-w-[120px]">
              <div className="flex items-center justify-between text-xs">
                <span className="text-ui-muted">LFIL</span>
                <span className="font-semibold text-ui-accent">
                  {fill.toFixed(0)}%
                </span>
              </div>
              <ProgressBar value={fill} className="mt-1.5" />
            </div>
          </div>
          <div className="mt-4">
            <p className="text-xs text-ui-muted">Empty runs (approximation)</p>
            <p className="mt-1 text-sm font-medium text-ui-primary">
              {emptyRuns.toFixed(0)}%
            </p>
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm text-ui-secondary">
          No active route for this vehicle.
        </p>
      )}
    </Card>
  );
}

function VehiclesView({
  vehicles,
  sessionsByVehicle,
}: {
  vehicles: VehicleConfig[];
  sessionsByVehicle: Map<string, DashboardSessionSummary>;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const setSessionId = useSessionStore((state) => state.setSessionId);
  const [selected, setSelected] = useState(0);
  const [detail, setDetail] = useState<SessionDetailResponse | null>(null);
  const [planning, setPlanning] = useState(false);

  const vehicle = vehicles[selected];
  const matchedSession = vehicle
    ? sessionsByVehicle.get(vehicle.name)
    : undefined;

  useEffect(() => {
    if (!matchedSession) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void fetchSessionDetail(matchedSession.id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [matchedSession]);

  async function handlePlanTrace() {
    if (!vehicle) return;
    setPlanning(true);
    try {
      const session = await createSession({ vehicle_id: vehicle.id });
      setSessionId(session.id);
      router.push("/planner");
    } catch (err) {
      showToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Nie udało się utworzyć sesji.",
      });
      setPlanning(false);
    }
  }

  if (!vehicle) {
    return (
      <p className="text-sm text-ui-secondary">No vehicles in the catalog.</p>
    );
  }

  return (
    <div className="grid h-[calc(100dvh-9rem)] mb-6 grid-cols-1 items-stretch gap-6 lg:grid-cols-[320px_1fr]">
      <aside className="flex h-full min-h-0 flex-col gap-3 rounded-2xl bg-ui-surface p-3">
        <button
          type="button"
          disabled
          className="flex w-full shrink-0 items-center justify-center gap-1.5 rounded-lg bg-ui-nav py-2 text-xs font-semibold text-ui-muted opacity-70"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add vehicle
        </button>
        <div className="min-h-0 flex-1 space-y-2 py-2 px-2 overflow-y-auto pr-1">
          {vehicles.map((v, i) => (
            <button
              type="button"
              key={v.id}
              onClick={() => setSelected(i)}
              className={cn(
                "w-full rounded-2xl bg-transparent px-3 py-2 text-left transition-colors",
                selected === i ? "ring-1 ring-ui-accent" : "hover:bg-ui-nav/50",
              )}
            >
              <div className="rounded-xl bg-ui-raised p-3">
                <TruckIllustration className="h-20 w-full" />
              </div>
              <div className="mt-2 px-2 pb-2 pt-1">
                <div className="flex items-start justify-between">
                  <p className="font-semibold text-ui-primary">{v.name}</p>
                  <MoreVertical className="size-4 text-ui-muted" aria-hidden="true" />
                </div>
                <div className="mt-1 flex items-center gap-3 text-sm text-ui-secondary">
                  <span>{v.type}</span>
                </div>
                <div className="mt-2 flex items-center gap-4 text-sm text-ui-secondary">
                  <span className="flex items-center gap-1">
                    <Ruler className="size-3.5 text-ui-muted" aria-hidden="true" />
                    {v.maxLdm} LDM
                  </span>
                  <span className="flex items-center gap-1">
                    <Weight className="size-3.5 text-ui-muted" aria-hidden="true" />
                    {(v.maxWeightKg / 1000).toFixed(1)} t
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[auto_1fr] gap-6 lg:grid-cols-3">
        {/* rząd 1 — dane, ilustracja, route stats */}
        <Card className=" p-5 ">
          <div className="flex items-start justify-between">
            <h2 className="text-xl font-semibold text-ui-primary">{vehicle.name}</h2>
            <span className="text-sm text-ui-muted">{vehicle.type}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-y-2.5">
            <StatRow icon={Ruler}>{vehicle.maxLdm} LDM</StatRow>
            <StatRow icon={Weight}>{vehicle.maxWeightKg} kg</StatRow>
            <StatRow icon={Fuel}>{vehicle.fuelPer100kmBase ?? "—"} L / 100 km</StatRow>
            <StatRow icon={MapPin}>max {vehicle.maxStops ?? "—"} przyst.</StatRow>
          </div>
          <div className="mt-4">
            <button
              type="button"
              disabled={planning}
              onClick={() => void handlePlanTrace()}
              className="flex items-center justify-center gap-2 rounded-full bg-ui-black px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {planning ? "Tworzenie sesji…" : "Plan trace"}
              <Navigation  className="size-4" aria-hidden="true" />
            </button>
          </div>
        </Card>

        <Card className="flex items-center justify-center border-0 bg-ui-surface p-5 shadow-none">
          <TruckIllustration className="h-[160px] w-full max-w-xs" />
        </Card>

        <RouteStatsCard detail={detail} />

        {/* rząd 2 — specyfikacja + mapa na pełną pozostałą wysokość */}
        <Card className="min-h-0 border-0 p-5 shadow-none">
          <h3 className="text-base font-semibold text-ui-primary">Specification</h3>
          <dl className="mt-4 text-sm">
            {[
              ["Typ", vehicle.type],
              ["Max LDM", `${vehicle.maxLdm}`],
              ["Max masa", `${vehicle.maxWeightKg} kg`],
              ["Długość naczepy", `${vehicle.trailerLengthCm} cm`],
              ["Szerokość naczepy", `${vehicle.trailerWidthCm} cm`],
              ["Max przystanków", `${vehicle.maxStops ?? "—"}`],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex items-center justify-between border-b border-ui-border/50 py-2.5 last:border-0"
              >
                <dt className="text-ui-secondary">{k}</dt>
                <dd className="font-medium text-ui-primary">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className="col-span-1 min-h-0 overflow-hidden border-0 p-0 shadow-none lg:col-span-2">
          <EuropeMap center={[17, 52.2]} scale={2600}>
            <SquareMarker coordinates={WARSAW} label="#1" />
          </EuropeMap>
        </Card>
      </div>
    </div>
  );
}

function DriversView({ drivers }: { drivers: DriverProfileRecord[] }) {
  const [selected, setSelected] = useState(0);
  const driver = drivers[selected];

  if (!driver) {
    return <p className="text-sm text-ui-secondary">Brak profili kierowców.</p>;
  }

  const initials = driver.name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="grid h-[calc(100dvh-9rem)] grid-cols-1 items-stretch gap-6 lg:grid-cols-[320px_1fr]">
      <aside className="flex h-full min-h-0 flex-col gap-3 rounded-2xl bg-ui-surface p-3">
        <button
          type="button"
          disabled
          className="flex w-full shrink-0 items-center justify-center gap-1.5 rounded-lg bg-ui-nav py-2 text-xs font-semibold text-ui-muted opacity-70"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add driver
        </button>
        <div className="min-h-0 flex-1 space-y-2 p-2 overflow-y-auto pr-1">
          {drivers.map((d, i) => (
            <button
              type="button"
              key={d.id}
              onClick={() => setSelected(i)}
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl bg-transparent px-4 py-3 text-left transition-colors",
                selected === i ? "ring-1 ring-ui-accent" : "hover:bg-ui-nav/50",
              )}
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-ui-raised text-ui-secondary">
                <User className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-ui-primary">{d.name}</p>
                  <MoreVertical className="size-4 text-ui-muted" aria-hidden="true" />
                </div>
                <div className="mt-1 flex items-center gap-3 text-sm text-ui-secondary">
                  <span className="flex items-center gap-1">
                    <IdCard className="size-3.5 text-ui-muted" aria-hidden="true" />
                    {d.code}
                  </span>
                  <span className="text-ui-muted">{d.hourly_cost_eur} EUR/h</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <div className="grid h-full min-h-0 grid-rows-[auto_1fr] gap-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Card className="border-0 p-5 shadow-none">
            <h2 className="text-xl font-semibold text-ui-primary">{driver.name}</h2>
            <div className="mt-4 grid grid-cols-2 gap-y-2.5">
              <StatRow icon={IdCard}>{driver.code}</StatRow>
              <StatRow icon={Banknote}>{driver.hourly_cost_eur} EUR / h</StatRow>
              <StatRow icon={Fuel}>{driver.idle_fuel_l_per_hour} L / h jałowo</StatRow>
              <StatRow icon={Truck}>{driver.stop_admin_fee_eur} EUR / stop</StatRow>
            </div>
          </Card>

          <Card className="border-0 p-5 shadow-none">
            <h3 className="text-base font-semibold text-ui-primary">Driver cost profile</h3>
            <p className="mt-2 text-sm text-ui-secondary">
              Driver cost profile fuels the cost calculation of the route (hourly rate,
              idle fuel consumption, stop administration fee).
            </p>
          </Card>
        </div>

        <Card className="min-h-0 overflow-hidden border-0 p-0 shadow-none">
          <EuropeMap center={[17, 52.2]} scale={2600}>
            <Marker coordinates={WARSAW}>
              <g transform="translate(-15, -13)">
                <rect
                  width={30}
                  height={26}
                  rx={7}
                  fill="#1a38f5"
                  stroke="#fff"
                  strokeWidth={1.5}
                />
                <text
                  x={15}
                  y={17}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={700}
                  fill="#fff"
                >
                  {initials || "?"}
                </text>
              </g>
            </Marker>
          </EuropeMap>
        </Card>
      </div>
    </div>
  );
}

export default function FleetPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-ui-secondary">Wczytywanie floty…</p>}
    >
      <FleetPageInner />
    </Suspense>
  );
}

function FleetPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab: Tab =
    searchParams.get("tab") === "drivers" ? "Drivers" : "Vehicles";
  const [tab, setTab] = useState<Tab>(initialTab);

  const [vehicles, setVehicles] = useState<VehicleConfig[]>([]);
  const [drivers, setDrivers] = useState<DriverProfileRecord[]>([]);
  const [recentSessions, setRecentSessions] = useState<
    DashboardSessionSummary[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [vehicleList, driverList] = await Promise.all([
          fetchVehicles(),
          fetchDriverProfiles(),
        ]);
        if (cancelled) return;
        setVehicles(vehicleList);
        setDrivers(driverList);
        try {
          const dashboard = await fetchDashboard();
          if (!cancelled) setRecentSessions(dashboard.recent_sessions);
        } catch {
          /* statystyki tras opcjonalne */
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Nie udało się wczytać floty.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const sessionsByVehicle = useMemo(() => {
    const map = new Map<string, DashboardSessionSummary>();
    for (const session of recentSessions) {
      if (session.vehicle_name && !map.has(session.vehicle_name)) {
        map.set(session.vehicle_name, session);
      }
    }
    return map;
  }, [recentSessions]);

  function handleTab(next: Tab) {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "Drivers") {
      params.set("tab", "drivers");
    } else {
      params.delete("tab");
    }
    router.replace(`/fleet${params.toString() ? `?${params.toString()}` : ""}`);
  }

  if (loading) {
    return <p className="text-sm text-ui-secondary">Wczytywanie floty…</p>;
  }

  if (error) {
    return (
      <p className="text-sm text-ui-error" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <SegmentedToggle options={TABS} value={tab} onChange={handleTab} />
      {tab === "Vehicles" ? (
        <VehiclesView
          vehicles={vehicles}
          sessionsByVehicle={sessionsByVehicle}
        />
      ) : (
        <DriversView drivers={drivers} />
      )}
    </div>
  );
}
