"use client";

import type { ReactNode } from "react";

import { AppShell } from "@/components/loadmax/AppShell";
import { ToastProvider, ToastViewport } from "@/components/ui/Toast";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-ui-bg text-ui-primary">
        <AppShell>{children}</AppShell>
      </div>
      <ToastViewport />
    </ToastProvider>
  );
}
