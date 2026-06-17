"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  LayoutGrid,
  Truck,
  BarChart3,
  LineChart,
  User,
} from "lucide-react";

import { cn } from "@/lib/utils";

const NAV = [
  { icon: Home, label: "Dashboard", route: "/dashboard" },
  { icon: LayoutGrid, label: "Planning lab", route: "/planner" },
  { icon: Truck, label: "Fleet manager", route: "/fleet" },
  { icon: BarChart3, label: "Market hub", route: "/market" },
  { icon: LineChart, label: "Analytics", route: "/analytics" },
];

export function AppHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-ui-border grid grid-cols-[auto_1fr_auto] items-center gap-2 bg-bg/80 px-3 py-4 backdrop-blur sm:grid-cols-[0.5fr_1fr_0.5fr] sm:px-6">

        <div className="text-md h-full flex items-center">LoadMax</div>

        <nav
          aria-label="Primary"
          className="flex min-w-0 items-center justify-center overflow-x-auto rounded-full p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {NAV.map(({ icon: Icon, label, route }) => {
            const active = pathname === route || pathname.startsWith(`${route}/`);
            return (
              <Link
                key={route}
                href={route}
                data-testid={`nav-${route.slice(1)}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center rounded-full py-2 text-sm font-medium transition-all duration-300",
                  active
                    ? "bg-ui-surface pl-2.5 pr-3.5 text-ui-primary "
                    : "px-2.5 text-ui-secondary bg-white/70 hover:bg-white/80 hover:text-ui-primary",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full transition-all duration-300",
                    active ? "" : "bg-white/20",
                  )}
                >
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                </span>
                <span
                  className={cn(
                    "overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out",
                    active ? "ml-2 max-w-28 opacity-100" : "max-w-0 opacity-0",
                  )}
                >
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            aria-label="Konto użytkownika"
            className="flex size-9 items-center justify-center rounded-full  bg-ui-surface/70 text-ui-secondary hover:text-ui-primary"
          >
            <User className="size-5" aria-hidden="true" />
          </button>
        </div>
    </header>
  );
}
