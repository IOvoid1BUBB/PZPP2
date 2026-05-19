import type { ReactNode } from "react";

const NAV_ITEMS = [
  { label: "Dashboard", href: "#", active: false },
  { label: "Planning lab", href: "#", active: true },
  { label: "Fleet Manager", href: "#", active: false },
  { label: "Market hub", href: "#", active: false },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="app-nav">
        <div className="app-nav__brand">Loadmax AI</div>
        <nav className="app-nav__links" aria-label="Główna nawigacja">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className={item.active ? "app-nav__link app-nav__link--active" : "app-nav__link"}
              aria-current={item.active ? "page" : undefined}
            >
              <span className="app-nav__icon" aria-hidden="true" />
              {item.label}
            </a>
          ))}
        </nav>
        <button type="button" className="app-nav__profile" aria-label="Profil użytkownika">
          <span className="app-nav__avatar" aria-hidden="true" />
        </button>
      </header>
      <div className="app-content">{children}</div>
    </div>
  );
}
