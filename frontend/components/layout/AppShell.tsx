import type { ReactNode } from "react";

import { AppHeader } from "@/components/layout/AppHeader";


export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--ui-bg)] text-[var(--ui-text-primary)]">
      <AppHeader />
      <div className="flex-1 px-4 py-6 md:px-7 md:py-8">{children}</div>
    </div>
  );
}
