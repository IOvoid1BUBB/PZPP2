"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { ToastProvider, ToastViewport } from "@/components/ui/Toast";
import { useHydratedSessionId } from "@/hooks/useHydratedSessionId";

function useNavItems() {
  const sessionId = useHydratedSessionId();
  const sessionPath = sessionId
    ? `/sessions/${sessionId}`
    : "/sessions/demo-session";

  return [
    { href: "/planner", label: "Planner" },
    { href: "/analytics", label: "Analytics" },
    { href: sessionPath, label: "Sesja" },
    { href: `${sessionPath}/map`, label: "Mapa trasy" },
  ];
}

function classes(...items: Array<string | false>) {
  return items.filter(Boolean).join(" ");
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const navItems = useNavItems();

  return (
    <ToastProvider>
      <div className="min-h-screen bg-[var(--ui-bg)] text-[var(--ui-text-primary)]">
        <div className="mx-auto grid min-h-screen max-w-[1600px] grid-cols-1 md:grid-cols-[240px_1fr]">
          <aside className="border-b border-[var(--ui-border)] bg-[var(--ui-nav)] p-4 md:border-b-0 md:border-r">
            <div className="mb-6 text-lg font-semibold">Loadmax AI</div>
            <div className="mb-6">
              <ThemeToggle />
            </div>
            <nav className="grid gap-2" aria-label="Dashboard navigation">
              {navItems.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={classes(
                      "rounded-md px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-[var(--ui-surface)] text-[var(--ui-text-primary)]"
                        : "text-[var(--ui-text-secondary)] hover:bg-[var(--ui-surface-raised)]",
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </aside>

          <main className="p-4 md:p-6">{children}</main>
        </div>
      </div>
      <ToastViewport />
    </ToastProvider>
  );
}
