"use client";

/**
 * VehicleSelector — pierwszy krok workflow spedytora.
 *
 * Flow po wyborze pojazdu (handleSelect):
 *   1. selectVehicle(vehicle)   — useVehicleStore (Task 1.4)
 *   2. clearAllSlots()          — useLoadStore    (Task 2.2)
 *   3. POST /api/v1/sessions    — sessionClient
 *   4. setSessionId(session.id) — useSessionStore (Task 1.5)
 *
 * Ponowny wybór tej samej karty zawsze tworzy nową sesję (reset workflow).
 *
 * Dostępność: radiogroup + button[role=radio] + roving tabindex.
 * Brak zewnętrznych bibliotek UI (shadcn/MUI/Radix).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import {
  fetchDriverProfiles,
  fetchVehicles,
  type DriverProfileRecord,
} from "@/lib/api/sessionClient";
import { useClientHydrated } from "@/hooks/useClientHydrated";
import type { VehicleConfig } from "@/lib/types/load";
import { useVehicleStore } from "@/lib/stores/vehicleStore";
import { useLoadStore } from "@/lib/stores/loadStore";
import { useSessionStore } from "@/lib/stores/sessionStore";

// ─── UI config ──────────────────────────────────────────────────────────────

/**
 * Lokalna konfiguracja kart UI.
 * Pola wyświetlane bezpośrednio na kartach — NIE zawiera id (pochodzi z API).
 * Wartości zgodne z backend/scripts/seed_vehicles.py.
 */
export interface VehicleSelectorConfig {
  type: "master_l2" | "master_l3" | "master_l4" | "man_solo";
  label: string;
  trailerLengthCm: number;
  trailerWidthCm: number;
  maxLdm: number;
  maxWeightKg: number;
  maxStops: number;
  fuelPer100kmBase: number;
}

export const VEHICLE_CONFIGS: VehicleSelectorConfig[] = [
  {
    type: "master_l2",
    label: "Renault Master L2",
    trailerLengthCm: 420,
    trailerWidthCm: 220,
    maxLdm: 6.4,
    maxWeightKg: 3500,
    maxStops: 6,
    fuelPer100kmBase: 18.5,
  },
  {
    type: "master_l3",
    label: "Renault Master L3",
    trailerLengthCm: 440,
    trailerWidthCm: 220,
    maxLdm: 7.2,
    maxWeightKg: 3600,
    maxStops: 6,
    fuelPer100kmBase: 18.5,
  },
  {
    type: "master_l4",
    label: "Renault Master L4",
    trailerLengthCm: 484,
    trailerWidthCm: 220,
    maxLdm: 8.0,
    maxWeightKg: 3800,
    maxStops: 6,
    fuelPer100kmBase: 19.0,
  },
  {
    type: "man_solo",
    label: "MAN Solówka",
    trailerLengthCm: 890,
    trailerWidthCm: 245,
    maxLdm: 17.6,
    maxWeightKg: 24000,
    maxStops: 10,
    fuelPer100kmBase: 28.0,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTonnage(kg: number): string {
  return (kg / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 1 });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface TrailerThumbnailProps {
  lengthCm: number;
  widthCm: number;
}

/** Proporcjonalny prostokąt naczepy jako wizualizacja. */
function TrailerThumbnail({ lengthCm, widthCm }: TrailerThumbnailProps) {
  const ratio = lengthCm / widthCm;

  return (
    <div className="vehicle-selector__thumb-wrapper">
      <div
        className="vehicle-selector__thumb"
        style={
          {
            "--trailer-ratio": ratio,
            background: "var(--ui-trailer-bed)",
          } as CSSProperties
        }
        aria-hidden="true"
      />
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function VehicleSelector() {
  const hydrated = useClientHydrated();
  const { selectedVehicle, selectVehicle } = useVehicleStore();
  const { clearAllSlots } = useLoadStore();
  const { setSessionId } = useSessionStore();

  /** Cache pojazdów z API — klucz: type */
  const [vehicleMap, setVehicleMap] = useState<Map<string, VehicleConfig>>(
    new Map(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [driverProfiles, setDriverProfiles] = useState<DriverProfileRecord[]>([]);
  const [selectedDriverProfileId, setSelectedDriverProfileId] = useState<string>("");
  /**
   * Fleet vehicles — if available, shown as labels on type cards.
   * Key: vehicle type string (e.g. "man_solo") → registration of first matching fleet vehicle.
   */
  const [fleetRegistrationByType, setFleetRegistrationByType] = useState<
    Map<string, string>
  >(new Map());

  /** Roving tabindex — indeks aktywnej karty w obrębie radiogroup */
  const [rovingIndex, setRovingIndex] = useState(0);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Pobierz pojazdy przy mount i zapisz w mapie (type → VehicleConfig)
  useEffect(() => {
    let cancelled = false;

    fetchVehicles()
      .then((vehicles) => {
        if (cancelled) return;
        const map = new Map(vehicles.map((v) => [v.type, v]));
        setVehicleMap(map);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Failed to fetch vehicles.");
        }
      });

    fetchDriverProfiles()
      .then((profiles) => {
        if (cancelled) return;
        setDriverProfiles(profiles);
        if (profiles.length > 0) {
          setSelectedDriverProfileId(profiles[0].id);
        }
      })
      .catch(() => {
        /* driver profile list optional for vehicle cards */
      });

    // Try loading fleet vehicles — if present, show registration on cards (graceful degradation)
    import("@/lib/api/fleetClient")
      .then(({ fetchFleetVehicles }) => fetchFleetVehicles())
      .then((fleetVehicles) => {
        if (cancelled) return;
        const regMap = new Map<string, string>();
        for (const fv of fleetVehicles) {
          if (fv.status !== "retired" && !regMap.has(fv.typeKey)) {
            regMap.set(fv.typeKey, fv.registration);
          }
        }
        setFleetRegistrationByType(regMap);
      })
      .catch(() => {
        /* fleet endpoint optional */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = useCallback(
    async (uiConfig: VehicleSelectorConfig) => {
      const vehicle = vehicleMap.get(uiConfig.type);

      if (!vehicle) {
        setError(
          "Brak danych pojazdu. Sprawdź połączenie z backendem.",
        );
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // 1. Update selected vehicle (vehicleStore + loadStore.vehicle)
        selectVehicle(vehicle);

        // 2. Clear slots synchronously — show empty canvas immediately
        clearAllSlots();

        // 3. Reset session — session is created only at "Utwórz sesję" step
        setSessionId(null);
        useLoadStore.getState().setSessionId(null);

        // 4. Set vehicle in loadStore so TrailerCanvas can render payload slots
        useLoadStore.getState().setVehicle(vehicle);
      } catch {
        setError("Nie udało się zainicjować pojazdu. Spróbuj ponownie.");
      } finally {
        setLoading(false);
      }
    },
    [vehicleMap, selectVehicle, clearAllSlots, setSessionId],
  );

  // ── Roving tabindex keyboard navigation ────────────────────────────────────

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      const total = VEHICLE_CONFIGS.length;

      switch (event.key) {
        case "Enter":
        case " ": {
          event.preventDefault();
          void handleSelect(VEHICLE_CONFIGS[index]);
          break;
        }
        case "ArrowRight":
        case "ArrowDown": {
          event.preventDefault();
          const next = (index + 1) % total;
          setRovingIndex(next);
          cardRefs.current[next]?.focus();
          break;
        }
        case "ArrowLeft":
        case "ArrowUp": {
          event.preventDefault();
          const prev = (index - 1 + total) % total;
          setRovingIndex(prev);
          cardRefs.current[prev]?.focus();
          break;
        }
      }
    },
    [handleSelect],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section className="vehicle-selector" aria-label="Wybór pojazdu">
      <h2 className="vehicle-selector__heading">Wybierz pojazd</h2>

      {driverProfiles.length > 0 ? (
        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-[var(--ui-text-secondary)]">
            Profil kierowcy
          </span>
          <select
            className="w-full max-w-md rounded-md border border-[var(--ui-border)] bg-[var(--ui-bg)] px-3 py-2"
            value={selectedDriverProfileId}
            onChange={(event) => setSelectedDriverProfileId(event.target.value)}
            disabled={loading}
          >
            {driverProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} ({profile.code})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {error && (
        <p className="vehicle-selector__error" role="alert">
          {error}
        </p>
      )}

      <div
        role="radiogroup"
        aria-label="Wybór pojazdu"
        className="vehicle-selector__grid"
      >
        {VEHICLE_CONFIGS.map((config, index) => {
          const isSelected =
            hydrated && selectedVehicle?.type === config.type;
          const isDisabled = loading;
          const fleetReg = fleetRegistrationByType.get(config.type);

          return (
            <button
              key={config.type}
              ref={(el) => {
                cardRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              id={`vehicle-card-${config.type}`}
              aria-checked={isSelected}
              aria-label={`${config.label}${fleetReg ? ` (${fleetReg})` : ""}, max ${config.maxStops} przystanków`}
              aria-disabled={isDisabled}
              tabIndex={rovingIndex === index ? 0 : -1}
              disabled={isDisabled}
              className={
                isSelected
                  ? "vehicle-selector__card vehicle-selector__card--selected"
                  : "vehicle-selector__card"
              }
              onClick={() => void handleSelect(config)}
              onFocus={() => setRovingIndex(index)}
              onKeyDown={(e) => handleKeyDown(e, index)}
            >
              {/* Loading spinner overlay */}
              {loading && isSelected && (
                <span
                  className="vehicle-selector__spinner"
                  aria-hidden="true"
                />
              )}

              {/* Tytuł + optional fleet registration badge */}
              <div className="flex items-start justify-between gap-1">
                <span className="vehicle-selector__label">{config.label}</span>
                {fleetReg && (
                  <span className="rounded bg-ui-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-ui-accent">
                    {fleetReg}
                  </span>
                )}
              </div>

              {/* Thumbnail naczepy */}
              <TrailerThumbnail
                lengthCm={config.trailerLengthCm}
                widthCm={config.trailerWidthCm}
              />

              {/* Statystyki */}
              <dl className="vehicle-selector__stats">
                <div>
                  <dt>Max LDM</dt>
                  <dd>{config.maxLdm}</dd>
                </div>
                <div>
                  <dt>Max tonaż</dt>
                  <dd>{formatTonnage(config.maxWeightKg)} t</dd>
                </div>
                <div>
                  <dt>Przystanki</dt>
                  <dd>max {config.maxStops} przystanków</dd>
                </div>
                <div>
                  <dt>Paliwo (baza)</dt>
                  <dd>{config.fuelPer100kmBase} l/100 km</dd>
                </div>
              </dl>
            </button>
          );
        })}
      </div>
    </section>
  );
}
