import { AppShell } from "@/components/layout/AppShell";
import { SlotEditor } from "@/components/planner/SlotEditor";
import { VehicleSelector } from "@/components/planner/VehicleSelector";

export function PlanningLabPage() {
  return (
    <AppShell>
      <div>
        <h1 className="mb-5 text-3xl font-bold tracking-tight">Planning lab</h1>
        <VehicleSelector />
        <SlotEditor />
      </div>
    </AppShell>
  );
}
