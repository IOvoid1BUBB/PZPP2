"use client";

import type { CSSProperties } from "react";
import { TruckIllustration } from "@/components/loadmax/TruckIllustration";
import { cn } from "@/lib/utils";

export interface VehicleTypeSummary {
  id: string;
  typeKey: string;
  typeName: string;
  maxLdm: number;
  maxWeightKg: number;
}

interface VehicleTypeCardProps {
  vehicle: VehicleTypeSummary;
  selected: boolean;
  onSelect: () => void;
}

export function VehicleTypeCard({ vehicle, selected, onSelect }: VehicleTypeCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-2 rounded-2xl border p-4 text-left transition-colors",
        selected
          ? "border-ui-accent ring-2 ring-ui-accent bg-ui-surface"
          : "border-ui-border bg-ui-raised hover:border-ui-accent/50",
      )}
    >
      <TruckIllustration className="h-16 w-full" />
      <p className="font-semibold text-sm text-ui-primary">{vehicle.typeName}</p>
      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-ui-secondary">
        <dt>Max LDM</dt>
        <dd>{vehicle.maxLdm}</dd>
        <dt>Max masa</dt>
        <dd>{(vehicle.maxWeightKg / 1000).toFixed(1)} t</dd>
      </dl>
    </button>
  );
}
