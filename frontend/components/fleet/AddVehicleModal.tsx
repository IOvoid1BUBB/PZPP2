"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { VehicleTypeCard, type VehicleTypeSummary } from "@/components/fleet/VehicleTypeCard";
import { fetchVehicles } from "@/lib/api/sessionClient";
import { createFleetVehicle, updateFleetVehicle } from "@/lib/api/fleetClient";
import type { FleetVehicle } from "@/lib/api/fleetClient";

// Top 10 Polish/DE/FR/NL cities for home location picker
const CITY_OPTIONS: { label: string; lat: number; lon: number }[] = [
  { label: "Warszawa, PL", lat: 52.2297, lon: 21.0122 },
  { label: "Kraków, PL", lat: 50.0647, lon: 19.9450 },
  { label: "Gdańsk, PL", lat: 54.3520, lon: 18.6466 },
  { label: "Wrocław, PL", lat: 51.1079, lon: 17.0385 },
  { label: "Poznań, PL", lat: 52.4064, lon: 16.9252 },
  { label: "Berlin, DE", lat: 52.5200, lon: 13.4050 },
  { label: "Hamburg, DE", lat: 53.5511, lon: 9.9937 },
  { label: "Paris, FR", lat: 48.8566, lon: 2.3522 },
  { label: "Amsterdam, NL", lat: 52.3676, lon: 4.9041 },
  { label: "Rotterdam, NL", lat: 51.9244, lon: 4.4777 },
];

interface AddVehicleModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (vehicle: FleetVehicle) => void;
  /** When provided the modal switches to edit mode (PUT /fleet/{id}). */
  vehicle?: FleetVehicle;
}

/** Closest city option for a home coordinate (used to pre-fill edit mode). */
function cityIndexFor(lat: number | null, lon: number | null): number {
  if (lat == null || lon == null) return 0;
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  CITY_OPTIONS.forEach((city, i) => {
    const d = (city.lat - lat) ** 2 + (city.lon - lon) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

export function AddVehicleModal({ open, onClose, onCreated, vehicle }: AddVehicleModalProps) {
  const isEdit = Boolean(vehicle);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleTypeSummary[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [registration, setRegistration] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [selectedCity, setSelectedCity] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void fetchVehicles().then((vehicles) => {
      const types: VehicleTypeSummary[] = vehicles.map((v) => ({
        id: v.id,
        typeKey: v.type,
        typeName: v.name,
        maxLdm: v.maxLdm,
        maxWeightKg: v.maxWeightKg,
      }));
      setVehicleTypes(types);
      if (types.length > 0 && !selectedTypeId) {
        setSelectedTypeId(vehicle?.typeId ?? types[0].id);
      }
    });
  }, [open, selectedTypeId, vehicle?.typeId]);

  // Pre-fill form fields when (re)opening in edit mode.
  useEffect(() => {
    if (!open) return;
    if (vehicle) {
      setSelectedTypeId(vehicle.typeId);
      setRegistration(vehicle.registration);
      setDisplayName(vehicle.displayName);
      setSelectedCity(cityIndexFor(vehicle.homeLat, vehicle.homeLon));
    }
    setError(null);
  }, [open, vehicle]);

  const handleSubmit = useCallback(async () => {
    if (!registration.trim() || !displayName.trim() || (!isEdit && !selectedTypeId)) {
      setError("Wypełnij wszystkie wymagane pola.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const city = CITY_OPTIONS[selectedCity];
      let saved: FleetVehicle;
      if (vehicle) {
        saved = await updateFleetVehicle(vehicle.id, {
          registration: registration.trim(),
          display_name: displayName.trim(),
          home_lat: city?.lat ?? null,
          home_lon: city?.lon ?? null,
        });
      } else {
        saved = await createFleetVehicle({
          type_id: selectedTypeId,
          registration: registration.trim(),
          display_name: displayName.trim(),
          home_lat: city?.lat ?? null,
          home_lon: city?.lon ?? null,
        });
        // Reset form only after a successful create.
        setRegistration("");
        setDisplayName("");
        setSelectedCity(0);
      }
      onCreated(saved);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isEdit
            ? "Błąd zapisu pojazdu."
            : "Błąd tworzenia pojazdu.",
      );
    } finally {
      setSaving(false);
    }
  }, [selectedTypeId, registration, displayName, selectedCity, onCreated, vehicle, isEdit]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Edytuj pojazd" : "Dodaj pojazd"}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl bg-ui-bg p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ui-primary">
            {isEdit ? "Edytuj pojazd" : "Dodaj pojazd"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ui-muted hover:text-ui-primary"
            aria-label="Zamknij"
          >
            ✕
          </button>
        </div>

        {/* Vehicle type selector — locked in edit mode (type is immutable). */}
        <section className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-ui-secondary">
            Typ pojazdu
            {isEdit ? (
              <span className="ml-2 text-xs font-normal text-ui-muted">
                (typu nie można zmienić)
              </span>
            ) : null}
          </h3>
          <div
            className={`grid grid-cols-2 gap-3 ${isEdit ? "pointer-events-none opacity-60" : ""}`}
            aria-disabled={isEdit}
          >
            {vehicleTypes.map((vt) => (
              <VehicleTypeCard
                key={vt.id}
                vehicle={vt}
                selected={selectedTypeId === vt.id}
                onSelect={() => {
                  if (!isEdit) setSelectedTypeId(vt.id);
                }}
              />
            ))}
          </div>
        </section>

        {/* Registration + display name */}
        <section className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ui-secondary">
              Numer rejestracyjny <span className="text-ui-error">*</span>
            </span>
            <input
              type="text"
              placeholder="np. WA 1234X"
              maxLength={20}
              value={registration}
              onChange={(e) => setRegistration(e.target.value)}
              className="rounded-md border border-ui-border bg-ui-bg px-3 py-2 text-sm text-ui-primary"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ui-secondary">
              Nazwa pojazdu <span className="text-ui-error">*</span>
            </span>
            <input
              type="text"
              placeholder="np. MAN Warszawa #1"
              maxLength={100}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="rounded-md border border-ui-border bg-ui-bg px-3 py-2 text-sm text-ui-primary"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ui-secondary">Lokalizacja bazowa</span>
            <select
              value={selectedCity}
              onChange={(e) => setSelectedCity(Number(e.target.value))}
              className="rounded-md border border-ui-border bg-ui-bg px-3 py-2 text-sm text-ui-primary"
            >
              {CITY_OPTIONS.map((city, i) => (
                <option key={city.label} value={i}>
                  {city.label}
                </option>
              ))}
            </select>
          </label>
        </section>

        {error && (
          <p className="mt-3 text-sm text-ui-error" role="alert">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Anuluj
          </Button>
          <Button
            variant="primary"
            disabled={saving}
            onClick={() => void handleSubmit()}
          >
            {saving
              ? isEdit
                ? "Zapisywanie…"
                : "Tworzenie…"
              : isEdit
                ? "Zapisz zmiany"
                : "Dodaj pojazd"}
          </Button>
        </div>
      </div>
    </div>
  );
}
