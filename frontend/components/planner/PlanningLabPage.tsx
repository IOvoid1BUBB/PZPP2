import { AppShell } from "@/components/layout/AppShell";
import { SlotEditor } from "@/components/planner/SlotEditor";

export function PlanningLabPage() {
  return (
    <AppShell>
      <div className="planning-lab">
        <h1 className="planning-lab__title">Planning lab</h1>
        <SlotEditor />
      </div>
    </AppShell>
  );
}
