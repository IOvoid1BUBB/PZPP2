"use client";

import { PlanningLabPage } from "@/components/planner/PlanningLabPage";
import { ToastProvider, ToastViewport } from "@/components/ui/Toast";

export default function Page() {
  return (
    <ToastProvider>
      <PlanningLabPage />
      <ToastViewport />
    </ToastProvider>
  );
}
