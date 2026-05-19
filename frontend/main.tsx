import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { PlanningLabPage } from "@/components/planner/PlanningLabPage";
import { ToastProvider, ToastViewport } from "@/components/ui/Toast";
import "@/globals.css";

function App() {
  return (
    <ToastProvider>
      <PlanningLabPage />
      <ToastViewport />
    </ToastProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
