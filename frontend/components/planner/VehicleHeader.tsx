"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, Send } from "lucide-react";

import { DriverRouteBriefing } from "@/components/driver/DriverRouteBriefing";
import { Drawer } from "@/components/ui/Drawer";
import { ProgressBar } from "../ui/ProgressBar";
import { cn } from "@/lib/utils";
import { useVehicleStore } from "@/lib/stores/vehicleStore";
import { useLoadStore } from "@/lib/stores/loadStore";
import { useSessionStore } from "@/lib/stores/sessionStore";
import { fetchVehicles, createSession } from "@/lib/api/sessionClient";
import { fetchSessionLayout } from "@/lib/api/plannerClient";
import type { VehicleConfig } from "@/lib/types/load";
import { VEHICLE_CONFIGS } from "./VehicleSelector";

// ─── VehicleTile ──────────────────────────────────────────────────────────────

const DRIVER_PROFILE_OPTIONS = ["Economy", "Senior"] as const;

function VehicleTile() {
  const { selectedVehicle, selectVehicle } = useVehicleStore();
  const { clearAllSlots, setLayout } = useLoadStore();
  const { setSessionId } = useSessionStore();

  const [open, setOpen] = useState(false);
  const [vehicleMap, setVehicleMap] = useState<Map<string, VehicleConfig>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchVehicles()
      .then((vehicles) => {
        setVehicleMap(new Map(vehicles.map((v) => [v.type, v])));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const handleSelect = useCallback(
    async (config: (typeof VEHICLE_CONFIGS)[0]) => {
      const vehicle = vehicleMap.get(config.type);
      if (!vehicle) {
        setError("Brak danych pojazdu. Sprawdź połączenie z backendem.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        selectVehicle(vehicle);
        clearAllSlots();
        const session = await createSession({ vehicle_id: vehicle.id });
        setSessionId(session.id);
        try {
          const layout = await fetchSessionLayout(session.id);
          setLayout({ sessionId: session.id, vehicle: layout.vehicle, slots: layout.slots });
        } catch {
          /* pusty layout */
        }
      } catch {
        setError("Nie udało się zainicjować sesji. Spróbuj ponownie.");
      } finally {
        setLoading(false);
        setOpen(false);
      }
    },
    [vehicleMap, selectVehicle, clearAllSlots, setLayout, setSessionId],
  );

  const uiConfig = selectedVehicle
    ? VEHICLE_CONFIGS.find((c) => c.type === selectedVehicle.type)
    : null;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="group flex w-full flex-col gap-2 rounded-md border-b border-transparent bg-ui-surface p-4 text-left transition-colors hover:border-primary disabled:opacity-60"
      >
        <span className="flex items-center justify-between text-xs text-ui-secondary">
          Vehicle
          <ChevronDown
            className={cn(
              "size-3 shrink-0 transition-transform duration-200 group-hover:text-primary",
              open && "rotate-180",
            )}
          />
        </span>
        <span className="truncate text-sm font-semibold text-ui-primary">
          {loading ? "Ładowanie…" : (uiConfig?.label ?? "—")}
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Wybierz pojazd"
          className="absolute left-0 top-full z-50 mt-1 min-w-[256px] overflow-hidden rounded-md bg-ui-surface shadow-lg"
        >
          {error && (
            <p className="px-3 py-2 text-xs text-red-500">{error}</p>
          )}
          {VEHICLE_CONFIGS.map((config) => {
            const isSelected = selectedVehicle?.type === config.type;
            return (
              <button
                key={config.type}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => void handleSelect(config)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-gray/30",
                  isSelected && "bg-gray/60",
                )}
              >
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full border transition-colors",
                    isSelected
                      ? "border-primary bg-ui-primary"
                      : "border-primary",
                  )}
                />
                <span className="flex-1 text-left text-sm font-medium text-ui-primary">
                  {config.label}
                </span>
                <span className="text-xs text-ui-secondary">
                  {config.maxLdm} LDM
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DriverProfileTile() {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<(typeof DRIVER_PROFILE_OPTIONS)[number]>(
    "Economy",
  );
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex w-full flex-col gap-2 rounded-md bg-ui-surface p-4 text-left transition-colors hover:bg-ui-nav"
      >
        <span className="flex items-center justify-between text-xs text-ui-secondary">
          Profile
          <ChevronDown
            className={cn(
              "size-3 shrink-0 transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </span>
        <span className="truncate text-sm font-semibold text-ui-primary">{profile}</span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Wybierz profil kierowcy"
          className="absolute left-0 top-full z-50 mt-1 min-w-[220px] overflow-hidden rounded-md bg-ui-surface shadow-lg"
        >
          {DRIVER_PROFILE_OPTIONS.map((option) => {
            const selected = profile === option;
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setProfile(option);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2.5 text-sm transition-colors hover:bg-gray/30",
                  selected && "bg-gray/60",
                )}
              >
                <span className="font-medium text-ui-primary">{option}</span>
                {selected ? <span className="text-xs text-ui-secondary">selected</span> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── VehicleHeader ────────────────────────────────────────────────────────────

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(value)}%`;
}

interface VehicleHeaderProps {
  driverName?: string;
  itemsCount?: number;
  usedWeightKg?: number;
  maxWeightKg?: number;
  usedLdm?: number;
  maxLdm?: number;
  profitEur?: number;
  saving?: boolean;
  onSave?: () => void;
  sessionId?: string;
}

export function VehicleHeader({
  driverName = "—",
  itemsCount = 0,
  usedWeightKg = 0,
  maxWeightKg,
  usedLdm: _usedLdm = 0,
  maxLdm: _maxLdm = 0,
  profitEur,
  saving,
  onSave,
  sessionId,
}: VehicleHeaderProps) {
  const lfilPercent = 50; //maxLdm > 0 ? (usedLdm / maxLdm) * 100 : 0;
  const [briefingOpen, setBriefingOpen] = useState(false);

  const metrics = [
    { label: "Driver", value: driverName },
    { label: "Items", value: String(itemsCount) },
    {
      label: "Weight",
      value: maxWeightKg ? `${Math.round(usedWeightKg)} / ${maxWeightKg}kg` : "—",
    },
    {
      label: "Profit",
      value: profitEur != null ? `${profitEur} EUR` : "—",
    },
  ];

  return (
    <header className="flex items-center justify-between gap-4">
      <div className="flex flex-1 gap-2" role="group" aria-label="Statystyki pojazdu">
        <VehicleTile />
        <DriverProfileTile />

        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="flex flex-col gap-2 rounded-md bg-ui-surface p-4"
          >
            <span className="text-xs text-ui-secondary">{metric.label}</span>
            <span className="text-sm font-semibold text-ui-primary">{metric.value}</span>
          </div>
        ))}

        <div className="flex flex-1 flex-col justify-between gap-2 rounded-md bg-ui-surface p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-ui-secondary">LFIL</span>
            <span className="text-sm font-semibold text-blue-500">
              {formatPercent(lfilPercent)}
            </span>
          </div>
          <ProgressBar tone="blue" value={lfilPercent} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        {sessionId ? (
          <button
            type="button"
            onClick={() => setBriefingOpen(true)}
            aria-label="Otwórz plan trasy dla kierowcy"
            className="inline-flex items-center gap-2 rounded-full border border-ui-border bg-ui-surface px-5 py-2.5 text-sm font-semibold text-ui-primary transition-colors hover:bg-ui-nav"
          >
           Driver briefing
          </button>
        ) : null}
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !onSave}
          className="inline-flex items-center gap-2 rounded-full bg-ui-black py-2 pl-2 pr-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-white/15">
            <Send className="size-3" aria-hidden="true" />
          </span>
          {saving ? "Wysyłanie…" : "Send to driver"}
        </button>
      </div>

      {sessionId ? (
        <Drawer
          open={briefingOpen}
          title="Plan trasy dla kierowcy"
          onClose={() => setBriefingOpen(false)}
        >
          <DriverRouteBriefing sessionId={sessionId} variant="full" />
        </Drawer>
      ) : null}
    </header>
  );
}
