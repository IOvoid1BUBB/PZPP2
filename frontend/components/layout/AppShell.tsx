import type { ReactNode } from "react";

import { AppHeader } from "@/components/layout/AppHeader";

const NAV_ITEMS = [
  { label: "Dashboard", href: "#", active: false },
  { label: "Planning lab", href: "#", active: true },
  { label: "Fleet Manager", href: "#", active: false },
  { label: "Market hub", href: "#", active: false },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--ui-bg)] text-[var(--ui-text-primary)]">
      <AppHeader navItems={NAV_ITEMS} />
      <div className="flex-1 px-4 py-6 md:px-7 md:py-8">{children}</div>
    </div>
  );
}
