"use client";

import { AppHeader } from "@/components/layout/AppHeader";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <main className="px-6 mt-2 mb-12">{children}</main>
    </>
  );
}
