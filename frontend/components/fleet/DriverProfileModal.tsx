"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import {
  createDriverProfile,
  updateDriverProfile,
  type DriverProfilePayload,
  type DriverProfileRecord,
} from "@/lib/api/sessionClient";

interface DriverProfileModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (profile: DriverProfileRecord) => void;
  /** When provided the modal edits this profile instead of creating a new one. */
  profile?: DriverProfileRecord;
}

interface FormState {
  name: string;
  code: string;
  hourly_cost_eur: string;
  idle_fuel_l_per_hour: string;
  stop_admin_fee_eur: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  code: "",
  hourly_cost_eur: "",
  idle_fuel_l_per_hour: "",
  stop_admin_fee_eur: "",
};

function NumberField({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-ui-secondary">
        {label} <span className="text-ui-error">*</span>
      </span>
      <input
        type="number"
        min={min}
        step="0.01"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-ui-border bg-ui-bg px-3 py-2 text-sm text-ui-primary"
      />
    </label>
  );
}

export function DriverProfileModal({
  open,
  onClose,
  onSaved,
  profile,
}: DriverProfileModalProps) {
  const isEdit = Boolean(profile);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (profile) {
      setForm({
        name: profile.name,
        code: profile.code,
        hourly_cost_eur: String(profile.hourly_cost_eur),
        idle_fuel_l_per_hour: String(profile.idle_fuel_l_per_hour),
        stop_admin_fee_eur: String(profile.stop_admin_fee_eur),
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, profile]);

  const update = (key: keyof FormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = useCallback(async () => {
    const hourly = Number(form.hourly_cost_eur);
    const idle = Number(form.idle_fuel_l_per_hour);
    const stopFee = Number(form.stop_admin_fee_eur);

    if (!form.name.trim() || !form.code.trim()) {
      setError("Nazwa i kod są wymagane.");
      return;
    }
    if (
      [hourly, idle, stopFee].some((n) => !Number.isFinite(n)) ||
      form.hourly_cost_eur === "" ||
      form.idle_fuel_l_per_hour === "" ||
      form.stop_admin_fee_eur === ""
    ) {
      setError("Wszystkie pola liczbowe są wymagane.");
      return;
    }
    if (hourly < 0 || stopFee < 0 || idle < 0) {
      setError("Wartości kosztowe nie mogą być ujemne.");
      return;
    }

    const payload: DriverProfilePayload = {
      name: form.name.trim(),
      code: form.code.trim(),
      hourly_cost_eur: hourly,
      idle_fuel_l_per_hour: idle,
      stop_admin_fee_eur: stopFee,
    };

    setSaving(true);
    setError(null);
    try {
      const saved = profile
        ? await updateDriverProfile(profile.id, payload)
        : await createDriverProfile(payload);
      onSaved(saved);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Nie udało się zapisać profilu kierowcy.",
      );
    } finally {
      setSaving(false);
    }
  }, [form, profile, onSaved]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Edytuj profil kierowcy" : "Dodaj profil kierowcy"}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-y-auto rounded-2xl bg-ui-bg p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ui-primary">
            {isEdit ? "Edytuj profil kierowcy" : "Dodaj profil kierowcy"}
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

        <section className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ui-secondary">
              Nazwa <span className="text-ui-error">*</span>
            </span>
            <input
              type="text"
              maxLength={100}
              value={form.name}
              onChange={(e) => update("name")(e.target.value)}
              placeholder="np. Standardowy"
              className="rounded-md border border-ui-border bg-ui-bg px-3 py-2 text-sm text-ui-primary"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ui-secondary">
              Kod <span className="text-ui-error">*</span>
            </span>
            <input
              type="text"
              maxLength={40}
              value={form.code}
              onChange={(e) => update("code")(e.target.value)}
              placeholder="np. standard"
              className="rounded-md border border-ui-border bg-ui-bg px-3 py-2 text-sm text-ui-primary"
            />
          </label>
          <NumberField
            label="Koszt godzinowy (EUR/h)"
            value={form.hourly_cost_eur}
            onChange={update("hourly_cost_eur")}
          />
          <NumberField
            label="Spalanie jałowe (L/h)"
            value={form.idle_fuel_l_per_hour}
            onChange={update("idle_fuel_l_per_hour")}
          />
          <NumberField
            label="Opłata administracyjna / stop (EUR)"
            value={form.stop_admin_fee_eur}
            onChange={update("stop_admin_fee_eur")}
          />
        </section>

        {error && (
          <p className="mt-3 text-sm text-ui-error" role="alert">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Anuluj
          </Button>
          <Button variant="primary" disabled={saving} onClick={() => void handleSubmit()}>
            {saving
              ? isEdit
                ? "Zapisywanie…"
                : "Tworzenie…"
              : isEdit
                ? "Zapisz zmiany"
                : "Dodaj profil"}
          </Button>
        </div>
      </div>
    </div>
  );
}
