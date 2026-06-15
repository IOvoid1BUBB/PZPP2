"use client";

import Link from "next/link";

import { DriverHoursWarning } from "@/components/planner/DriverHoursWarning";
import { SlotEditor } from "@/components/planner/SlotEditor";
import { SolverPanel } from "@/components/planner/SolverPanel";
import { VehicleSelector } from "@/components/planner/VehicleSelector";
import { Button } from "@/components/ui/Button";
import { useHydratedSessionId } from "@/hooks/useHydratedSessionId";
import { usePlannerLayout } from "@/hooks/usePlannerLayout";

export default function PlannerPage() {
  const sessionId = useHydratedSessionId();
  const { reload } = usePlannerLayout();

  return (
    <section className="planning-lab">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="planning-lab__title">Visual Load Planner</h1>
        {sessionId ? (
          <Link href={`/sessions/${sessionId}/map`}>
            <Button variant="secondary">Mapa trasy</Button>
          </Link>
        ) : (
          <p className="text-sm text-[var(--ui-text-secondary)]">
            Wybierz pojazd, aby otworzyć mapę trasy.
          </p>
        )}
      </div>
      <DriverHoursWarning />
      <VehicleSelector />
      <SolverPanel sessionId={sessionId} onApplied={() => void reload()} />
      <SlotEditor />
    </section>
  );
}
