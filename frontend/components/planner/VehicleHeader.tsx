"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Send } from "lucide-react";

import { DriverRouteBriefing } from "@/components/driver/DriverRouteBriefing";
import { Drawer } from "@/components/ui/Drawer";
import { ProgressBar } from "../ui/ProgressBar";
import { cn } from "@/lib/utils";
import { useVehicleStore } from "@/lib/stores/vehicleStore";
import {
  fetchDriverProfiles,
  type DriverProfileRecord,
} from "@/lib/api/sessionClient";

// ─── DriverProfileTile ────────────────────────────────────────────────────────

interface DriverProfileTileProps {
  /** Currently selected driver profile id (controlled). */
  value?: string;
  /** Fired with the chosen profile id when the user picks a different profile. */
  onChange?: (profileId: string) => void;
  disabled?: boolean;
}

function DriverProfileTile({ value, onChange, disabled = false }: DriverProfileTileProps) {
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<DriverProfileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Load driver profiles from the API once on mount (BUG-06: no hardcoded options).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchDriverProfiles()
      .then((records) => {
        if (!cancelled) setProfiles(records);
      })
      .catch(() => {
        if (!cancelled) setProfiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
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

  const selectedProfile =
    profiles.find((p) => p.id === value) ?? (value == null ? profiles[0] : undefined);
  const label = loading
    ? "Ładowanie…"
    : (selectedProfile?.name ?? selectedProfile?.code ?? "—");

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled || loading}
        className="flex w-full flex-col gap-2 rounded-md bg-ui-surface p-4 text-left transition-colors hover:bg-ui-nav disabled:cursor-not-allowed disabled:opacity-60"
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
        {loading ? (
          <span className="h-4 w-20 animate-pulse rounded bg-ui-raised" aria-hidden="true" />
        ) : (
          <span className="truncate text-sm font-semibold text-ui-primary">{label}</span>
        )}
      </button>

      {open && !loading && (
        <div
          role="listbox"
          aria-label="Wybierz profil kierowcy"
          className="absolute left-0 top-full z-50 mt-1 min-w-[220px] overflow-hidden rounded-md bg-ui-surface shadow-lg"
        >
          {profiles.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-ui-secondary">Brak profili</p>
          ) : (
            profiles.map((option) => {
              const selected = selectedProfile?.id === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange?.(option.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2.5 text-sm transition-colors hover:bg-gray/30",
                    selected && "bg-gray/60",
                  )}
                >
                  <span className="font-medium text-ui-primary">
                    {option.name ?? option.code}
                  </span>
                  {selected ? (
                    <span className="text-xs text-ui-secondary">selected</span>
                  ) : null}
                </button>
              );
            })
          )}
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
  onConfirm?: () => void;
  onCreateRoute?: () => void;
  onCreateSession?: () => void;
  onCancelRoute?: () => void;
  sessionId?: string;
  sessionStatus?: string;
  /** Selected driver profile id (controlled — wired to session creation / cost). */
  driverProfileId?: string;
  onDriverProfileChange?: (profileId: string) => void;
  /** Controls the two-step flow buttons */
  routeMode?: "none" | "create-route" | "route-preview" | "confirmed";
}

export function VehicleHeader({
  driverName = "—",
  itemsCount = 0,
  usedWeightKg = 0,
  maxWeightKg,
  usedLdm = 0,
  maxLdm = 0,
  profitEur,
  saving,
  onSave,
  onConfirm,
  onCreateRoute,
  onCreateSession,
  onCancelRoute,
  sessionId,
  sessionStatus,
  driverProfileId,
  onDriverProfileChange,
  routeMode = "none",
}: VehicleHeaderProps) {
  // BUG-04: LFIL reflects real loading-meter utilisation, not a constant.
  const lfilPercent = maxLdm > 0 ? Math.round((usedLdm / maxLdm) * 100) : 0;
  const [briefingOpen, setBriefingOpen] = useState(false);
  const selectedVehicle = useVehicleStore((state) => state.selectedVehicle);
  const readOnly =
    sessionStatus === "confirmed" || sessionStatus === "dispatched";

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
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div
        className="flex flex-1 flex-wrap gap-2"
        role="group"
        aria-label="Statystyki pojazdu"
      >
        {/* Static vehicle display tile — vehicle selection happens via VehicleSelector */}
        <div className="flex flex-col gap-2 rounded-md bg-ui-surface p-4">
          <span className="text-xs text-ui-secondary">Vehicle</span>
          <span className="truncate text-sm font-semibold text-ui-primary">
            {selectedVehicle?.name ?? "—"}
          </span>
        </div>

        <DriverProfileTile
          value={driverProfileId}
          onChange={onDriverProfileChange}
          disabled={readOnly}
        />

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

      <div className="flex items-center gap-2 [&>button]:min-h-[44px]">
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

        {/* Two-step flow: Utwórz trasę → Utwórz sesję */}
        {routeMode === "create-route" && onCreateRoute ? (
          <button
            type="button"
            onClick={onCreateRoute}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-full bg-ui-black py-2 pl-2 pr-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex size-6 items-center justify-center rounded-full bg-white/15">
              <Send className="size-3" aria-hidden="true" />
            </span>
            {saving ? "Ładowanie…" : "Utwórz trasę"}
          </button>
        ) : routeMode === "route-preview" ? (
          <>
            {onCancelRoute ? (
              <button
                type="button"
                onClick={onCancelRoute}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-full border border-ui-border bg-ui-surface px-5 py-2.5 text-sm font-semibold text-ui-primary transition-colors hover:bg-ui-nav disabled:opacity-50"
              >
                Anuluj
              </button>
            ) : null}
            {onCreateSession ? (
              <button
                type="button"
                onClick={onCreateSession}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-full bg-ui-black py-2 pl-2 pr-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="flex size-6 items-center justify-center rounded-full bg-white/15">
                  <Send className="size-3" aria-hidden="true" />
                </span>
                {saving ? "Tworzenie…" : "Utwórz sesję"}
              </button>
            ) : null}
          </>
        ) : routeMode === "confirmed" ? (
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-2 rounded-full bg-green-600 py-2 pl-2 pr-5 text-sm font-semibold text-white opacity-80 cursor-not-allowed"
          >
            <span className="flex size-6 items-center justify-center rounded-full bg-white/15">
              <Send className="size-3" aria-hidden="true" />
            </span>
            Trasa zatwierdzona ✓
          </button>
        ) : (onSave ?? onConfirm) ? (
          /* Existing session confirm button */
          <button
            type="button"
            onClick={onConfirm ?? onSave}
            disabled={saving || !(onConfirm ?? onSave)}
            className="inline-flex items-center gap-2 rounded-full bg-ui-black py-2 pl-2 pr-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex size-6 items-center justify-center rounded-full bg-white/15">
              <Send className="size-3" aria-hidden="true" />
            </span>
            {saving
              ? "Zapisywanie…"
              : sessionStatus === "confirmed" || sessionStatus === "dispatched"
                ? "Trasa zatwierdzona ✓"
                : "Zatwierdź trasę"}
          </button>
        ) : null}
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
