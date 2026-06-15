import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { ProfitBreakdownData } from "@/lib/api/profitClient";
import {
  buildWaterfallData,
  COLOR_COST,
  COLOR_PROFIT,
  formatEur,
} from "@/lib/analytics/buildWaterfallData";
import { ProfitWaterfall } from "./ProfitWaterfall";

vi.mock("recharts", async () => {
  type ChartProps = {
    data?: Array<{
      key: string;
      label: string;
      displayValue: number;
      fill: string;
      formula?: string;
    }>;
    children?: React.ReactNode;
  };

  const passthrough =
    () =>
    ({ children }: { children?: React.ReactNode }) =>
      <>{children}</>;

  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive-container">{children}</div>
    ),
    BarChart: ({ data = [], children }: ChartProps) => (
      <div data-testid="bar-chart">
        {data.map((row) => (
          <div
            key={row.key}
            data-testid="waterfall-bar"
            data-bar-key={row.key}
            data-fill={row.fill}
          >
            <span>{row.label}</span>
            <span>
              {row.displayValue < 0
                ? formatEur(row.displayValue)
                : formatEur(row.displayValue, true)}
            </span>
            {row.formula ? <span>{row.formula}</span> : null}
          </div>
        ))}
        {children}
      </div>
    ),
    Bar: passthrough(),
    Cell: passthrough(),
    CartesianGrid: passthrough(),
    XAxis: passthrough(),
    YAxis: passthrough(),
    Tooltip: passthrough(),
    LabelList: passthrough(),
    Rectangle: () => null,
  };
});

vi.mock("@/hooks/useClientHydrated", () => ({
  useClientHydrated: () => true,
}));

const mockUseProfitBreakdown = vi.fn();
vi.mock("@/hooks/useProfitBreakdown", () => ({
  useProfitBreakdown: (...args: unknown[]) => mockUseProfitBreakdown(...args),
}));

const mockUseLoadStore = vi.fn();
vi.mock("@/lib/stores/loadStore", () => ({
  useLoadStore: (selector: (state: unknown) => unknown) =>
    mockUseLoadStore(selector),
}));

function makeBreakdown(
  overrides: Partial<ProfitBreakdownData> = {},
): ProfitBreakdownData {
  return {
    revenueEur: 2000,
    fuelEur: 400,
    tollEur: 150,
    stopCostsEur: 80,
    driverEur: 200,
    maintenanceEur: 50,
    netProfitEur: 1120,
    stopCount: 3,
    formulas: {
      fuel: { litersTotal: 200, fuelPrice: 2 },
      toll: { distanceKm: 500 },
      stops: { stopCount: 3, perStopCost: 27 },
      driver: { daysOnRoad: 4, dailyAllowance: 50 },
      maintenance: { distanceKm: 500, maintRate: 0.1 },
    },
    legs: [{ legId: 1, fuelConsumption: 200 }],
    offerRevenue: [{ offerId: "offer-1", revenueEur: 2000 }],
    fromApi: true,
    ...overrides,
  };
}

function stubLoadStore(slots: Record<string, { offerId: string } | null>) {
  mockUseLoadStore.mockImplementation((selector) =>
    selector({
      slots,
      sessionId: "session-1",
    }),
  );
}

describe("ProfitWaterfall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseProfitBreakdown.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    stubLoadStore({});
  });

  it("shows empty state when no loads are on the trailer", () => {
    render(<ProfitWaterfall />);

    expect(
      screen.getByText("Dodaj ładunki, aby zobaczyć kalkulację"),
    ).toBeInTheDocument();
  });

  it("renders seven waterfall bars for a session with at least two stops", () => {
    stubLoadStore({ "slot-a": { offerId: "offer-1" } });
    const data = makeBreakdown({ stopCount: 3 });

    render(<ProfitWaterfall data={data} />);

    const bars = screen.getAllByTestId("waterfall-bar");
    expect(bars).toHaveLength(7);
    expect(screen.getByText("Przystanki")).toBeInTheDocument();
    expect(screen.getByText("200L × 2 EUR/L")).toBeInTheDocument();
    expect(screen.getByText("4 dni × 50 EUR/dzień")).toBeInTheDocument();
  });

  it("renders negative net profit label with minus sign and red bar", () => {
    stubLoadStore({ "slot-a": { offerId: "offer-1" } });
    const data = makeBreakdown({
      netProfitEur: -150,
      tollEur: 90,
      stopCount: 2,
    });

    render(<ProfitWaterfall data={data} />);

    const profitBar = document.querySelector('[data-bar-key="profit"]');
    expect(profitBar).toHaveTextContent("-150 EUR");
    expect(profitBar).toHaveAttribute("data-fill", COLOR_COST);
  });

  it("renders positive net profit with purple bar", () => {
    stubLoadStore({ "slot-a": { offerId: "offer-1" } });
    const data = makeBreakdown({ netProfitEur: 430, stopCount: 2 });

    render(<ProfitWaterfall data={data} />);

    const profitBar = document.querySelector('[data-bar-key="profit"]');
    expect(profitBar).toHaveTextContent("+430 EUR");
    expect(profitBar).toHaveAttribute("data-fill", COLOR_PROFIT);
  });

  it("shows loading state while profit breakdown is fetched", () => {
    stubLoadStore({ "slot-a": { offerId: "offer-1" } });
    mockUseProfitBreakdown.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      reload: vi.fn(),
    });

    render(<ProfitWaterfall />);

    expect(screen.getByText("Wczytywanie kalkulacji…")).toBeInTheDocument();
  });

  it("passes API breakdown through buildWaterfallData for chart rows", () => {
    stubLoadStore({ "slot-a": { offerId: "offer-1" } });
    const data = makeBreakdown({ stopCount: 2 });

    render(<ProfitWaterfall data={data} />);

    const expectedKeys = buildWaterfallData(data).map((row) => row.key);
    const renderedKeys = screen
      .getAllByTestId("waterfall-bar")
      .map((node) => node.getAttribute("data-bar-key"));

    expect(renderedKeys).toEqual(expectedKeys);
  });
});
