"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, Truck, BarChart3, User, Send } from "lucide-react";

import { cn } from "@/lib/utils";
import { usePlannerActionStore } from "@/lib/stores/plannerActionStore";

const NAV = [
  { icon: Home, label: "Dashboard", route: "/" },
  { icon: LayoutGrid, label: "Planning lab", route: "/planner" },
  { icon: Truck, label: "Fleet manager", route: "/fleet" },
  { icon: BarChart3, label: "Market hub", route: "/market" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPlanner = pathname === "/planner";

  const handler = usePlannerActionStore((state) => state.handler);
  const canSend = usePlannerActionStore((state) => state.canSend);
  const busy = usePlannerActionStore((state) => state.busy);

  return (
    <div className="mx-auto min-h-screen w-full max-w-[1600px]">
      <header className="sticky top-0 z-30 border-b border-ui-border bg-ui-surface/90 backdrop-blur">
        <div className="flex items-center gap-4 px-6 py-3">
          <span className="text-lg font-semibold text-ui-primary">Loadmax AI</span>

          <nav
            aria-label="Primary"
            className="mx-auto flex items-center gap-1 rounded-full bg-ui-nav p-1"
          >
            {NAV.map(({ icon: Icon, label, route }) => {
              const active =
                route === "/" ? pathname === "/" : pathname.startsWith(route);
              return (
                <Link
                  key={route}
                  href={route}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-ui-surface text-ui-primary shadow-sm"
                      : "text-ui-secondary hover:text-ui-primary",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className={cn(active ? "inline" : "hidden sm:inline")}>
                    {label}
                  </span>
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {isPlanner && (
              <button
                type="button"
                disabled={!canSend || busy || !handler}
                onClick={() => handler?.()}
                className="flex items-center gap-2 rounded-full bg-ui-black py-2 pl-2 pr-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="flex size-6 items-center justify-center rounded-full bg-white/15">
                  <Send className="size-3.5" aria-hidden="true" />
                </span>
                {busy ? "Wysyłanie…" : "Send to driver"}
              </button>
            )}
            <button
              type="button"
              aria-label="Konto"
              className="flex size-9 items-center justify-center rounded-full border border-ui-border bg-ui-surface text-ui-secondary hover:text-ui-primary"
            >
              <User className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main className="p-6">{children}</main>
    </div>
  );
}
