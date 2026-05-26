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

import { fetchVehicles, createSession } from "@/lib/api/sessionClient";
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
  type: "bus_8" | "bus_9" | "bus_10" | "solo";
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
    type: "bus_8",
    label: "Bus 8-pak",
    trailerLengthCm: 820,
    trailerWidthCm: 240,
    maxLdm: 13.6,
    maxWeightKg: 6000,
    maxStops: 6,
    fuelPer100kmBase: 18.5,
  },
  {
    type: "bus_9",
    label: "Bus 9-pak",
    trailerLengthCm: 920,
    trailerWidthCm: 240,
    maxLdm: 13.6,
    maxWeightKg: 7000,
    maxStops: 6,
    fuelPer100kmBase: 19.0,
  },
  {
    type: "bus_10",
    label: "Bus 10-pak",
    trailerLengthCm: 1020,
    trailerWidthCm: 240,
    maxLdm: 13.6,
    maxWeightKg: 8000,
    maxStops: 6,
    fuelPer100kmBase: 19.5,
  },
  {
    type: "solo",
    label: "Solówka",
    trailerLengthCm: 1360,
    trailerWidthCm: 240,
    maxLdm: 33.0,
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
            background: "var(--color-trailer-bed)",
          } as CSSProperties
        }
        aria-hidden="true"
      />
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function VehicleSelector() {
  const { selectedVehicle, selectVehicle } = useVehicleStore();
  const { clearAllSlots } = useLoadStore();
  const { setSessionId } = useSessionStore();

  /** Cache pojazdów z API — klucz: type */
  const [vehicleMap, setVehicleMap] = useState<Map<string, VehicleConfig>>(
    new Map(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          setError("Nie udało się pobrać listy pojazdów.");
        }
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
        // 1. Aktualizuj wybrany pojazd
        selectVehicle(vehicle);

        // 2. Wyczyść sloty ładunku
        clearAllSlots();

        // 3. Utwórz nową sesję konsolidacji
        const session = await createSession({ vehicle_id: vehicle.id });

        // 4. Zapisz ID sesji
        setSessionId(session.id);
      } catch {
        setError("Nie udało się zainicjować sesji. Spróbuj ponownie.");
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
          const isSelected = selectedVehicle?.type === config.type;
          const isDisabled = loading;

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
              aria-label={`${config.label}, max ${config.maxStops} przystanków`}
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

              {/* Tytuł */}
              <span className="vehicle-selector__label">{config.label}</span>

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
