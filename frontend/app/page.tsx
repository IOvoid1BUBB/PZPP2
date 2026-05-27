"use client";

import { useEffect, useState } from "react";

import { PlanningLabPage } from "@/components/planner/PlanningLabPage";
import { ToastProvider, ToastViewport } from "@/components/ui/Toast";

export default function Page() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <ToastProvider>
      {hydrated ? (
        <PlanningLabPage />
      ) : (
        <div className="planner-empty" aria-busy="true">
          Wczytywanie planera…
        </div>
      )}
      <ToastViewport />
    </ToastProvider>
  );
}
