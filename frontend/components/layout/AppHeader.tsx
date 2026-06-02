import { ThemeToggle } from "@/components/ui/ThemeToggle";

type NavItem = {
  label: string;
  href: string;
  active: boolean;
};

type AppHeaderProps = {
  navItems: NavItem[];
};

export function AppHeader({ navItems }: AppHeaderProps) {
  return (
    <header className="flex min-h-14 items-center justify-between gap-4 border-b border-[var(--ui-border)] bg-[var(--ui-nav)] px-4 md:px-6">
      <div className="min-w-0 shrink-0 text-sm font-semibold tracking-tight">
        Loadmax AI
      </div>

      <nav
        className="hidden min-w-0 flex-1 items-center justify-center gap-2 md:flex"
        aria-label="Główna nawigacja"
      >
        {navItems.map((item) => (
          <a
            key={item.label}
            href={item.href}
            className={
              item.active
                ? "inline-flex items-center gap-2 rounded-md bg-[var(--ui-surface)] px-3 py-2 text-sm font-medium text-[var(--ui-text-primary)]"
                : "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-[var(--ui-text-secondary)] hover:bg-[var(--ui-surface-raised)]"
            }
            aria-current={item.active ? "page" : undefined}
          >
            <span
              className="h-3.5 w-3.5 rounded-sm border border-[var(--ui-border-strong)]"
              aria-hidden="true"
            />
            {item.label}
          </a>
        ))}
      </nav>

      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
        <ThemeToggle />
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-raised)]"
          aria-label="Moj profil"
        >
          <span
            className="h-5 w-5 rounded-full border border-[var(--ui-border-strong)]"
            aria-hidden="true"
          />
          <span>Moj profil</span>
        </button>
      </div>
    </header>
  );
}
