import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { DashboardView } from "@/components/dashboard/DashboardView";
import type { DashboardResponse } from "@/lib/api/dashboardClient";
import type { SessionListItem } from "@/lib/api/sessionClient";

vi.mock("@/components/loadmax/EuropeMap", () => ({
  EuropeMap: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="europe-map">{children}</div>
  ),
}));

vi.mock("@/lib/stores/sessionStore", () => ({
  useSessionStore: (selector: (state: { sessionId: string | null }) => unknown) =>
    selector({ sessionId: null }),
}));

vi.mock("@/components/loadmax/MapMarkers", () => ({
  SquareMarker: ({
    label,
    onClick,
  }: {
    label: string;
    onClick?: () => void;
  }) => (
    <button type="button" data-testid={`marker-${label}`} onClick={onClick}>
      {label}
    </button>
  ),
}));

const dashboardPayload: DashboardResponse = {
  today_net_profit_eur: 250,
  today_net_profit_pln: 1080,
  avg_lfill_pct: 72,
  empty_runs_pct: 8,
  active_sessions: [
    {
      session_id: "11111111-1111-4111-8111-111111110001",
      vehicle_name: "Renault Master L2",
      current_location: "52.2200°N, 21.0100°E",
      destination: "Berlin",
      lfil_pct: 80,
      status: "dispatched",
      has_time_window_risk: false,
    },
  ],
  notifications: [
    {
      id: "empty-1",
      type: "free_space",
      title: "Wolna przestrzeń",
      body: "Sesja bez ofert.",
      link: "Zaplanuj załadunek →",
      href: "/planner?session=11111111-1111-4111-8111-111111110001",
    },
    {
      id: "tw-1",
      type: "time_window_risk",
      title: "Ryzyko okna czasowego",
      body: "Opóźnienie możliwe.",
    },
    {
      id: "hot-1",
      type: "hot_offer",
      title: "Aktywna giełda",
      body: "12 ofert na rynku.",
      link: "Przejdź do giełdy →",
      href: "/market",
    },
  ],
};

const dispatchedPayload: SessionListItem[] = [
  {
    id: "11111111-1111-4111-8111-111111110001",
    vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    driver_profile_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    status: "dispatched",
    created_at: "2026-06-16T08:00:00Z",
    total_revenue_eur: 1000,
    net_profit_eur: 200,
    solver_run_id: null,
  },
];

function mockFetchSuccess() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/dashboard")) {
        return new Response(JSON.stringify(dashboardPayload), { status: 200 });
      }
      if (url.includes("/api/v1/sessions")) {
        return new Response(JSON.stringify(dispatchedPayload), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

describe("DashboardView", () => {
  beforeEach(() => {
    mockFetchSuccess();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders KPI cards from dashboard API", async () => {
    render(<DashboardView />);
    await waitFor(() => {
      expect(screen.getByText(/1[\s\u00a0]?080 PLN/)).toBeInTheDocument();
    });
    expect(screen.getByText("Dzienny zysk netto")).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
    expect(screen.getByText("Średni LFILL")).toBeInTheDocument();
    expect(screen.getByText("8%")).toBeInTheDocument();
    expect(screen.getByText("Puste przebiegi")).toBeInTheDocument();
  });

  it("shows map markers and popup link to planner session", async () => {
    render(<DashboardView />);
    await waitFor(() => {
      expect(screen.getByTestId("europe-map")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("marker-RM"));
    expect(screen.getByRole("dialog", { name: "Szczegóły trasy" })).toBeInTheDocument();
    const plannerLink = screen.getAllByRole("link", { name: /Otwórz w plannerze/i })[0];
    expect(plannerLink).toHaveAttribute(
      "href",
      "/planner?session=11111111-1111-4111-8111-111111110001",
    );
  });

  it("renders operational notification types", async () => {
    render(<DashboardView />);
    await waitFor(() => {
      expect(screen.getByText("Wolna przestrzeń")).toBeInTheDocument();
    });
    expect(screen.getByText("Ryzyko okna czasowego")).toBeInTheDocument();
    expect(screen.getByText("Aktywna giełda")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zaplanuj załadunek →" })).toHaveAttribute(
      "href",
      "/planner?session=11111111-1111-4111-8111-111111110001",
    );
  });

  it("shows empty state when no dispatched routes today", async () => {
    const noRoutesPayload: DashboardResponse = {
      ...dashboardPayload,
      active_sessions: dashboardPayload.active_sessions.map((session) => ({
        ...session,
        status: "draft",
      })),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/v1/dashboard")) {
          return new Response(JSON.stringify(noRoutesPayload), { status: 200 });
        }
        if (url.includes("/api/v1/sessions")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    render(<DashboardView />);
    await waitFor(() => {
      expect(screen.getByText("Brak aktywnych tras dziś")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("europe-map")).not.toBeInTheDocument();
  });

  it("shows error when dashboard API fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("error", { status: 500 })),
    );

    render(<DashboardView />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/Nie udało się pobrać dashboardu/i);
    });
  });

  it("shows loading skeleton before data arrives", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    const { container } = render(<DashboardView />);
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("closes map popup on dismiss", async () => {
    render(<DashboardView />);
    await waitFor(() => {
      expect(screen.getByTestId("marker-RM")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("marker-RM"));
    expect(screen.getByRole("dialog", { name: "Szczegóły trasy" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zamknij" }));
    expect(screen.queryByRole("dialog", { name: "Szczegóły trasy" })).not.toBeInTheDocument();
  });
});
