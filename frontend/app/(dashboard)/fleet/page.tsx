"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Banknote,
  Fuel,
  IdCard,
  MapPin,
  MoreVertical,
  Navigation,
  Pencil,
  Plus,
  Ruler,
  Trash2,
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
import { AddVehicleModal } from "@/components/fleet/AddVehicleModal";
import { DriverProfileModal } from "@/components/fleet/DriverProfileModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import {
  createSession,
  deleteDriverProfile,
  fetchDriverProfiles,
  fetchSessionDetail,
  updateSessionStatus,
  type DriverProfileRecord,
  type SessionDetailResponse,
} from "@/lib/api/sessionClient";
import { buildCreateSessionParams } from "@/lib/fleet/resolveSessionOrigin";
import {
  fetchFleetVehicles,
  deleteFleetVehicle,
  endFleetTrip,
  type FleetVehicle,
} from "@/lib/api/fleetClient";
import { useVehicleSimulatedPosition } from "@/hooks/useVehicleSimulatedPosition";
import { useVehicleStore } from "@/lib/stores/vehicleStore";
import { useLoadStore } from "@/lib/stores/loadStore";
import { useSessionStore } from "@/lib/stores/sessionStore";
import { cn } from "@/lib/utils";

const WARSAW: [number, number] = [21.01, 52.22];
const TABS = ["Vehicles", "Drivers"] as const;
type Tab = (typeof TABS)[number];

const STATUS_COLOR: Record<FleetVehicle["status"], string> = {
  idle: "#9ca3af",
  in_route: "#1a38f5",
  maintenance: "#f97316",
  retired: "#6b7280",
};

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

function RouteStatsCard({
  detail,
  vehicle,
  onRefresh,
}: {
  detail: SessionDetailResponse | null;
  vehicle: FleetVehicle | null;
  onRefresh: () => void;
}) {
  const { showToast } = useToast();
  const [dispatching, setDispatching] = useState(false);
  const [endingTrip, setEndingTrip] = useState(false);
  const fill = detail ? detail.metrics.fill_pct : 0;

  async function handleEndTrip() {
    if (!vehicle) return;
    setEndingTrip(true);
    try {
      await endFleetTrip(vehicle.id);
      showToast({ type: "success", message: "Trasa zakończona — pojazd wrócił do bazy." });
      onRefresh();
    } catch (err) {
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "Nie udało się zakończyć trasy.",
      });
    } finally {
      setEndingTrip(false);
    }
  }

  async function handleDispatch() {
    if (!detail) return;
    setDispatching(true);
    try {
      await updateSessionStatus(detail.id, "dispatched");
      showToast({ type: "success", message: "Trasa wysłana do kierowcy." });
      onRefresh();
    } catch (err) {
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "Nie udało się wysłać trasy.",
      });
    } finally {
      setDispatching(false);
    }
  }

  return (
    <Card className="border-0 p-6 shadow-none">
      <h3 className="text-base font-semibold text-ui-primary">Route stats</h3>
      {detail ? (
        <>
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-ui-muted">
            Aktualna trasa
          </p>
          <div className="mt-3 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-ui-muted">Session status</p>
              <p className="mt-1 text-sm font-medium capitalize text-ui-primary">
                {detail.status}
              </p>
              <Link
                href="/planner"
                className="mt-1 inline-block text-xs font-medium text-ui-accent hover:underline"
              >
                Sesja {detail.id.slice(0, 8)}… → planner
              </Link>
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

          <div className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
            <div>
              <p className="text-xs text-ui-muted">Oferty</p>
              <p className="font-medium text-ui-primary">{detail.offers.length}</p>
            </div>
            <div>
              <p className="text-xs text-ui-muted">Przystanki</p>
              <p className="font-medium text-ui-primary">{detail.metrics.stop_count}</p>
            </div>
            {detail.metrics.estimated_net_profit_eur != null && (
              <div className="col-span-2">
                <p className="text-xs text-ui-muted">Est. zysk netto</p>
                <p className="font-semibold text-ui-accent">
                  {detail.metrics.estimated_net_profit_eur.toFixed(0)} EUR
                </p>
              </div>
            )}
          </div>

          {vehicle?.status === "in_route" && detail.status === "confirmed" && (
            <button
              type="button"
              disabled={dispatching}
              onClick={() => void handleDispatch()}
              className="mt-4 w-full rounded-full bg-ui-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {dispatching ? "Wysyłanie…" : "Wyślij do kierowcy"}
            </button>
          )}
          {detail.status === "dispatched" && (
            <>
              <p className="mt-3 text-xs font-medium text-green-600">
                ✅ Wysłano do kierowcy
              </p>
              <button
                type="button"
                disabled={endingTrip}
                onClick={() => void handleEndTrip()}
                className="mt-3 w-full rounded-full border border-ui-border px-4 py-2 text-sm font-semibold text-ui-primary hover:bg-ui-raised disabled:opacity-60"
              >
                {endingTrip ? "Kończenie…" : "Zakończ trasę"}
              </button>
            </>
          )}
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
  onRefresh,
}: {
  vehicles: FleetVehicle[];
  onRefresh: () => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const setSessionId = useSessionStore((state) => state.setSessionId);
  const setSessionContext = useVehicleStore((state) => state.setSessionContext);
  const clearAllSlots = useLoadStore((state) => state.clearAllSlots);
  const [selected, setSelected] = useState(0);
  const [detail, setDetail] = useState<SessionDetailResponse | null>(null);
  const [planning, setPlanning] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editVehicle, setEditVehicle] = useState<FleetVehicle | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const vehicle = vehicles[selected];

  // M4.T3: simulated vehicle position along the active route
  const simPosition = useVehicleSimulatedPosition(
    vehicle?.status === "in_route" ? vehicle.id : null,
  );

  useEffect(() => {
    if (!vehicle?.currentSessionId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void fetchSessionDetail(vehicle.currentSessionId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) setDetail(null); });
    return () => { cancelled = true; };
  }, [vehicle?.currentSessionId]);

  async function handlePlanTrace() {
    if (!vehicle) return;
    setPlanning(true);
    try {
      const origin =
        vehicle.homeLat != null && vehicle.homeLon != null
          ? { lat: vehicle.homeLat, lon: vehicle.homeLon }
          : undefined;
      const session = await createSession(
        buildCreateSessionParams(vehicle.typeId, {
          origin,
          fleetVehicleId: vehicle.id,
        }),
      );
      setSessionContext({
        origin: origin ?? { lat: 52.22, lon: 21.01 },
        fleetVehicleId: vehicle.id,
      });
      // Clear any stale slots/vehicle from the previous session before navigating.
      // The planner's usePlannerLayout will fetch the correct vehicle from the session.
      clearAllSlots();
      useLoadStore.getState().setLayout({ sessionId: session.id, vehicle: null, slots: {} });
      setSessionId(session.id);
      router.push("/planner");
    } catch (err) {
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "Nie udało się utworzyć sesji.",
      });
      setPlanning(false);
    }
  }

  async function handleDelete(vehicleId: string) {
    setDeleting(true);
    try {
      await deleteFleetVehicle(vehicleId);
      showToast({ type: "success", message: "Pojazd usunięty." });
      setConfirmDeleteId(null);
      setSelected(0);
      onRefresh();
    } catch (err) {
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "Nie udało się usunąć pojazdu.",
      });
    } finally {
      setDeleting(false);
    }
  }

  if (vehicles.length === 0) {
    return (
      <div className="py-16">
        <EmptyState
          icon={Truck}
          title="Brak pojazdów w flocie"
          description="Dodaj pierwszy pojazd do floty, aby rozpocząć planowanie tras."
          action={
            <Button variant="primary" onClick={() => setAddModalOpen(true)}>
              <Plus className="mr-1 size-4" />
              Dodaj pierwszy pojazd
            </Button>
          }
        />
        <AddVehicleModal
          open={addModalOpen}
          onClose={() => setAddModalOpen(false)}
          onCreated={() => { setAddModalOpen(false); onRefresh(); }}
        />
      </div>
    );
  }

  // Map marker: prefer simulated position, then API current, then home, then Warsaw
  const markerCoord: [number, number] = vehicle
    ? [
        simPosition?.lon ?? vehicle.currentLon ?? vehicle.homeLon ?? WARSAW[0],
        simPosition?.lat ?? vehicle.currentLat ?? vehicle.homeLat ?? WARSAW[1],
      ]
    : WARSAW;

  return (
    <div className="grid h-[calc(100dvh-9rem)] mb-6 grid-cols-1 items-stretch gap-6 lg:grid-cols-[320px_1fr]">
      <aside className="flex h-full min-h-0 flex-col gap-3 rounded-2xl bg-ui-surface p-3">
        <button
          type="button"
          onClick={() => setAddModalOpen(true)}
          className="flex w-full shrink-0 items-center justify-center gap-1.5 rounded-lg bg-ui-accent py-2 text-xs font-semibold text-white hover:opacity-90"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Dodaj pojazd
        </button>
        <div className="min-h-0 flex-1 space-y-2 py-2 px-2 overflow-y-auto pr-1">
          {vehicles.map((v, i) => (
            <div key={v.id} className="relative">
              <button
                type="button"
                onClick={() => setSelected(i)}
                className={cn(
                  "w-full rounded-2xl bg-transparent px-3 py-2 text-left transition-colors",
                  selected === i ? "ring-1 ring-ui-accent" : "hover:bg-ui-nav/50",
                )}
              >
                <div className="rounded-xl bg-ui-raised p-3">
                  <TruckIllustration className="h-16 w-full" />
                </div>
                <div className="mt-2 px-2 pb-2 pt-1">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-ui-primary">{v.registration}</p>
                      <p className="text-xs text-ui-muted">{v.typeName}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <span
                        className={cn(
                          "inline-block size-2 rounded-full",
                          v.status === "in_route" && "animate-pulse",
                        )}
                        style={{ background: STATUS_COLOR[v.status] }}
                        title={v.status}
                      />
                      <button
                        type="button"
                        aria-label="Opcje"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId((prev) => (prev === v.id ? null : v.id));
                        }}
                        className="text-ui-muted hover:text-ui-primary"
                      >
                        <MoreVertical className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-ui-secondary">
                    <span>{v.maxLdm} LDM</span>
                    <span>{(v.maxWeightKg / 1000).toFixed(1)} t</span>
                  </div>
                </div>
              </button>

              {/* Context menu */}
              {menuOpenId === v.id && (
                <div className="absolute right-2 top-10 z-10 rounded-xl border border-ui-border bg-ui-bg p-1 shadow-lg">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ui-primary hover:bg-ui-raised"
                    onClick={() => { setEditVehicle(v); setMenuOpenId(null); }}
                  >
                    <Pencil className="size-4" />
                    Edytuj pojazd
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ui-error hover:bg-ui-raised"
                    onClick={() => { setConfirmDeleteId(v.id); setMenuOpenId(null); }}
                  >
                    <Trash2 className="size-4" />
                    Usuń pojazd
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>

      {vehicle ? (
        <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[auto_1fr] gap-6 lg:grid-cols-3">
          <Card className="p-5">
            <div className="flex items-start justify-between">
              <h2 className="text-xl font-semibold text-ui-primary">{vehicle.registration}</h2>
              <span
                className="rounded-full px-2 py-0.5 text-xs font-semibold capitalize"
                style={{
                  background: `${STATUS_COLOR[vehicle.status]}22`,
                  color: STATUS_COLOR[vehicle.status],
                }}
              >
                {vehicle.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-ui-secondary">{vehicle.typeName}</p>
            <div className="mt-4 grid grid-cols-2 gap-y-2.5">
              <StatRow icon={Ruler}>{vehicle.maxLdm} LDM</StatRow>
              <StatRow icon={Weight}>{vehicle.maxWeightKg} kg</StatRow>
              <StatRow icon={MapPin}>
                {vehicle.currentLat != null
                  ? `${vehicle.currentLat.toFixed(2)}°N`
                  : vehicle.homeLat != null
                    ? `${vehicle.homeLat.toFixed(2)}°N (baza)`
                    : "—"}
              </StatRow>
              <StatRow icon={Navigation}>max przyst.</StatRow>
            </div>
            <div className="mt-4">
              <button
                type="button"
                disabled={planning}
                onClick={() => void handlePlanTrace()}
                className="flex items-center justify-center gap-2 rounded-full bg-ui-black px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
              >
                {planning ? "Tworzenie sesji…" : "Plan trace"}
                <Navigation className="size-4" aria-hidden="true" />
              </button>
              {/* M4.T3: route progress when in_route */}
              {simPosition && vehicle?.status === "in_route" && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ui-muted">Postęp trasy</span>
                    <span className="font-semibold text-ui-accent">
                      {simPosition.progressPct}%
                    </span>
                  </div>
                  <ProgressBar value={simPosition.progressPct} className="mt-1" />
                  <p className="mt-1 text-xs text-ui-muted">
                    Przystanek {simPosition.currentStopIndex + 1} / {simPosition.totalStops}
                  </p>
                </div>
              )}
            </div>
          </Card>

          <Card className="flex items-center justify-center border-0 bg-ui-surface p-5 shadow-none">
            <TruckIllustration className="h-[160px] w-full max-w-xs" />
          </Card>

          <RouteStatsCard detail={detail} vehicle={vehicle} onRefresh={onRefresh} />

          <Card className="min-h-0 border-0 p-5 shadow-none">
            <h3 className="text-base font-semibold text-ui-primary">Specification</h3>
            <dl className="mt-4 text-sm">
              {[
                ["Typ", vehicle.typeKey],
                ["Max LDM", `${vehicle.maxLdm}`],
                ["Max masa", `${vehicle.maxWeightKg} kg`],
                ["Długość naczepy", `${vehicle.trailerLengthCm} cm`],
                ["Szerokość naczepy", `${vehicle.trailerWidthCm} cm`],
                ["Rejestracja", vehicle.registration],
                ["Nazwa", vehicle.displayName],
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
            <EuropeMap center={[markerCoord[0], markerCoord[1]]} scale={1600}>
              <SquareMarker
                coordinates={markerCoord}
                label={vehicle.registration.slice(-3).toUpperCase()}
                color={
                  vehicle.status === "idle"
                    ? "grey"
                    : vehicle.status === "in_route"
                      ? "blue"
                      : vehicle.status === "maintenance"
                        ? "amber"
                        : "grey"
                }
              />
            </EuropeMap>
          </Card>
        </div>
      ) : null}

      <AddVehicleModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onCreated={() => { setAddModalOpen(false); onRefresh(); }}
      />

      {/* Edit vehicle modal (FEAT-06) */}
      <AddVehicleModal
        open={editVehicle !== null}
        vehicle={editVehicle ?? undefined}
        onClose={() => setEditVehicle(null)}
        onCreated={() => { setEditVehicle(null); onRefresh(); }}
      />

      {/* Delete confirmation dialog */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-80 rounded-2xl bg-ui-bg p-6 shadow-xl">
            <h3 className="text-base font-semibold text-ui-primary">Usuń pojazd?</h3>
            <p className="mt-2 text-sm text-ui-secondary">
              Pojazd zostanie usunięty lub oznaczony jako wycofany jeśli ma aktywne sesje.
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setConfirmDeleteId(null)}>
                Anuluj
              </Button>
              <Button
                variant="primary"
                disabled={deleting}
                onClick={() => void handleDelete(confirmDeleteId)}
                className="bg-ui-error hover:bg-ui-error/90"
              >
                {deleting ? "Usuwanie…" : "Usuń"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Close menu on outside click */}
      {menuOpenId && (
        <div
          className="fixed inset-0 z-[5]"
          onClick={() => setMenuOpenId(null)}
        />
      )}
    </div>
  );
}

function DriversView({
  drivers,
  onRefresh,
}: {
  drivers: DriverProfileRecord[];
  onRefresh: () => void;
}) {
  const { showToast } = useToast();
  const [selected, setSelected] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editProfile, setEditProfile] = useState<DriverProfileRecord | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      await deleteDriverProfile(id);
      showToast({ type: "success", message: "Profil kierowcy usunięty." });
      setConfirmDeleteId(null);
      setSelected(0);
      onRefresh();
    } catch (err) {
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "Nie udało się usunąć profilu.",
      });
    } finally {
      setDeleting(false);
    }
  }

  const driver = drivers[selected];

  const driverHeader = (
    <DriverProfileModal
      open={modalOpen || editProfile !== null}
      profile={editProfile ?? undefined}
      onClose={() => {
        setModalOpen(false);
        setEditProfile(null);
      }}
      onSaved={() => {
        setModalOpen(false);
        setEditProfile(null);
        onRefresh();
      }}
    />
  );

  const deleteDialog = confirmDeleteId ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-80 rounded-2xl bg-ui-bg p-6 shadow-xl">
        <h3 className="text-base font-semibold text-ui-primary">Usuń profil kierowcy?</h3>
        <p className="mt-2 text-sm text-ui-secondary">
          Tej operacji nie można cofnąć.
        </p>
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmDeleteId(null)}>
            Anuluj
          </Button>
          <Button
            variant="primary"
            disabled={deleting}
            onClick={() => void handleDelete(confirmDeleteId)}
            className="bg-ui-error hover:bg-ui-error/90"
          >
            {deleting ? "Usuwanie…" : "Usuń"}
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  if (!driver) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <p className="text-sm text-ui-secondary">Brak profili kierowców.</p>
        <Button variant="primary" onClick={() => setModalOpen(true)}>
          <Plus className="mr-1 size-4" />
          Dodaj pierwszy profil
        </Button>
        {driverHeader}
      </div>
    );
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
          onClick={() => setModalOpen(true)}
          className="flex w-full shrink-0 items-center justify-center gap-1.5 rounded-lg bg-ui-accent py-2 text-xs font-semibold text-white hover:opacity-90"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Dodaj profil
        </button>
        <div className="min-h-0 flex-1 space-y-2 p-2 overflow-y-auto pr-1">
          {drivers.map((d, i) => (
            <div
              key={d.id}
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl bg-transparent px-4 py-3 text-left transition-colors",
                selected === i ? "ring-1 ring-ui-accent" : "hover:bg-ui-nav/50",
              )}
            >
              <button
                type="button"
                onClick={() => setSelected(i)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="flex size-10 items-center justify-center rounded-full bg-ui-raised text-ui-secondary">
                  <User className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ui-primary">{d.name}</p>
                  <div className="mt-1 flex items-center gap-3 text-sm text-ui-secondary">
                    <span className="flex items-center gap-1">
                      <IdCard className="size-3.5 text-ui-muted" aria-hidden="true" />
                      {d.code}
                    </span>
                    <span className="text-ui-muted">{d.hourly_cost_eur} EUR/h</span>
                  </div>
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`Edytuj profil ${d.name}`}
                  onClick={() => setEditProfile(d)}
                  className="text-ui-muted hover:text-ui-primary"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Usuń profil ${d.name}`}
                  onClick={() => setConfirmDeleteId(d.id)}
                  className="text-ui-muted hover:text-ui-error"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
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
              Driver cost profile fuels the cost calculation of the route.
            </p>
          </Card>
        </div>

        <Card className="min-h-0 overflow-hidden border-0 p-0 shadow-none">
          <EuropeMap center={[17, 52.2]} scale={750}>
            <Marker coordinates={WARSAW}>
              <g transform="translate(-15, -13)">
                <rect width={30} height={26} rx={7} fill="#1a38f5" stroke="#fff" strokeWidth={1.5} />
                <text x={15} y={17} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">
                  {initials || "?"}
                </text>
              </g>
            </Marker>
          </EuropeMap>
        </Card>
      </div>

      {driverHeader}
      {deleteDialog}
    </div>
  );
}

export default function FleetPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ui-secondary">Wczytywanie floty…</p>}>
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

  const [fleetVehicles, setFleetVehicles] = useState<FleetVehicle[]>([]);
  const [drivers, setDrivers] = useState<DriverProfileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFleet = async () => {
    try {
      const [vehicleList, driverList] = await Promise.all([
        fetchFleetVehicles(),
        fetchDriverProfiles(),
      ]);
      setFleetVehicles(vehicleList);
      setDrivers(driverList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się wczytać floty.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFleet();
  }, []);

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
        <VehiclesView vehicles={fleetVehicles} onRefresh={() => void loadFleet()} />
      ) : (
        <DriversView drivers={drivers} onRefresh={() => void loadFleet()} />
      )}
    </div>
  );
}

// end of file
