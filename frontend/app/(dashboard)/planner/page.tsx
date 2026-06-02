"use client";

import { SlotEditor } from "@/components/planner/SlotEditor";
import { VehicleSelector } from "@/components/planner/VehicleSelector";

export default function PlannerPage() {
  return (
    <section className="planning-lab">
      <h1 className="planning-lab__title">Visual Load Planner</h1>
      <VehicleSelector />
      <SlotEditor />
    </section>
  );
}
