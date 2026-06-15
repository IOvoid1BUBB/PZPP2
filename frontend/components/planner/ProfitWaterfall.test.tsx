import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { getClientColorHex } from "@/components/planner/TrailerCanvas";
import type { LegCostRow, ProfitBreakdownData } from "@/lib/api/profitClient";
import { buildLegConsumptionData } from "@/lib/analytics/buildLegConsumptionData";
import {
  buildWaterfallData,
  COLOR_COST,
  COLOR_PROFIT,
  formatEur,
} from "@/lib/analytics/buildWaterfallData";
import { getLegColorByRatio } from "@/lib/map/legColors";
import { ProfitWaterfall } from "./ProfitWaterfall";

let lastBarProps: Record<string, unknown> | null = null;

vi.mock("recharts", async () => {
  type WaterfallRow = {
    key: string;
    label: string;
    displayValue: number;
    fill: string;
    formula?: string;
  };

  type LegRow = {
    key: string;
    label: string;
    consumptionL100km: number;
    fill: string;
    loadRatio: number;
  };

  type ChartProps = {
    data?: Array<WaterfallRow | LegRow>;
    children?: React.ReactNode;
  };

  type PieProps = {
    data?: Array<{
      clientId: string;
      name: string;
      value: number;
      fill: string;
      valueSource: string;
    }>;
    children?: React.ReactNode;
  };

  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  Passthrough.displayName = "RechartsPassthrough";

  const passthrough = () => Passthrough;

  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive-container">{children}</div>
    ),
    BarChart: ({ data = [], children }: ChartProps) => (
      <div data-testid="bar-chart">
        {data.map((row) => {
          if ("consumptionL100km" in row) {
            return (
              <div
                key={row.key}
                data-testid="leg-consumption-bar"
                data-bar-key={row.key}
                data-fill={row.fill}
                data-load-ratio={row.loadRatio}
              >
                <span>{row.label}</span>
                <span>{row.consumptionL100km}</span>
              </div>
            );
          }

          return (
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
          );
        })}
        {children}
      </div>
    ),
    PieChart: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="pie-chart">{children}</div>
    ),
    Pie: ({ data = [], children }: PieProps) => (
      <div data-testid="client-pie">
        {data.map((slice) => (
          <div
            key={slice.clientId}
            data-testid="pie-slice"
            data-client={slice.name}
            data-value={slice.value}
            data-fill={slice.fill}
            data-source={slice.valueSource}
          >
            {slice.name}
          </div>
        ))}
        {children}
      </div>
    ),
    Bar: (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      lastBarProps = props;
      return <div data-testid="bar-layer">{props.children}</div>;
    },
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
const mockUseClientSummary = vi.fn();
vi.mock("@/lib/stores/loadStore", () => ({
  useLoadStore: (selector: (state: unknown) => unknown) =>
    mockUseLoadStore(selector),
  useClientSummary: () => mockUseClientSummary(),
}));

function makeLegCost(
  overrides: Partial<LegCostRow> = {},
  legIndex = 0,
): LegCostRow {
  return {
    legIndex,
    distanceKm: 120,
    durationMinutes: 75,
    weightKgAtLeg: 8000,
    loadRatio: 0.35,
    consumptionL100km: 24.5,
    liters: 29.4,
    costEur: 58.8,
    ...overrides,
  };
}

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
    legCosts: [],
    offerRevenue: [{ offerId: "offer-1", revenueEur: 2000 }],
    fromApi: true,
    ...overrides,
  };
}

function stubLoadStore(
  slots: Record<
    string,
    {
      offerId: string;
      clientId?: string;
      clientName?: string;
      ldm?: number;
    } | null
  >,
) {
  mockUseLoadStore.mockImplementation((selector) =>
    selector({
      slots,
      sessionId: "session-1",
    }),
  );
}

function stubClientSummary(
  clients: Array<{
    clientId: string;
    offerId: string;
    name: string;
    ldm: number;
  }> = [],
) {
  mockUseClientSummary.mockReturnValue(
    clients.map((client) => ({
      ...client,
      color: "var(--ui-company-1-intense)",
      weight: 400,
    })),
  );
}

describe("ProfitWaterfall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastBarProps = null;
    mockUseProfitBreakdown.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    stubLoadStore({});
    stubClientSummary([]);
  });

  it("shows empty state when no loads are on the trailer", () => {
    render(<ProfitWaterfall />);

    expect(
      screen.getByText("Dodaj ładunki, aby zobaczyć kalkulację"),
    ).toBeInTheDocument();
  });

  it("renders seven waterfall bars for a session with at least two stops", () => {
    stubLoadStore({
      "slot-a": {
        offerId: "offer-1",
        clientId: "client-1",
        clientName: "Acme",
        ldm: 2,
      },
    });
    stubClientSummary([
      { clientId: "client-1", offerId: "offer-1", name: "Acme", ldm: 2 },
    ]);
    const data = makeBreakdown({ stopCount: 3 });

    render(<ProfitWaterfall data={data} />);

    const bars = screen.getAllByTestId("waterfall-bar");
    expect(bars).toHaveLength(7);
    expect(screen.getByText("Przystanki")).toBeInTheDocument();
    expect(screen.getByText("200L × 2 EUR/L")).toBeInTheDocument();
    expect(screen.getByText("4 dni × 50 EUR/dzień")).toBeInTheDocument();
    expect(screen.getByTestId("client-pie")).toBeInTheDocument();
  });

  it("renders client pie with API revenue and TrailerCanvas colors", () => {
    stubLoadStore({
      "slot-a": {
        offerId: "offer-1",
        clientId: "client-1",
        clientName: "Acme",
        ldm: 3,
      },
    });
    stubClientSummary([
      { clientId: "client-1", offerId: "offer-1", name: "Acme", ldm: 3 },
    ]);
    const data = makeBreakdown({
      stopCount: 2,
      offerRevenue: [{ offerId: "offer-1", revenueEur: 2000 }],
      fromApi: true,
    });

    render(<ProfitWaterfall data={data} />);

    const slice = screen.getByTestId("pie-slice");
    expect(slice).toHaveAttribute("data-value", "2000");
    expect(slice).toHaveAttribute("data-source", "revenue");
    expect(slice).toHaveAttribute(
      "data-fill",
      getClientColorHex("offer-1", false),
    );
    expect(screen.getByText("2000 EUR")).toBeInTheDocument();
  });

  it("renders estimated LDM share when API revenue is unavailable", () => {
    stubLoadStore({
      "slot-a": {
        offerId: "offer-1",
        clientId: "client-1",
        clientName: "Acme",
        ldm: 4,
      },
    });
    stubClientSummary([
      { clientId: "client-1", offerId: "offer-1", name: "Acme", ldm: 4 },
    ]);
    const data = makeBreakdown({
      stopCount: 2,
      fromApi: false,
      offerRevenue: [],
    });

    render(<ProfitWaterfall data={data} />);

    const slice = screen.getByTestId("pie-slice");
    expect(slice).toHaveAttribute("data-source", "estimated");
    expect(slice).toHaveAttribute("data-value", String(Math.round(4 * 187.5)));
    expect(screen.getByText(/4,0 LDM/)).toBeInTheDocument();
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

  it("toggles per-leg view and renders one bar per leg_cost", async () => {
    const user = userEvent.setup();
    stubLoadStore({ "slot-a": { offerId: "offer-1" } });
    const legCosts = [
      makeLegCost({ legIndex: 0, consumptionL100km: 18.5, loadRatio: 0.1 }),
      makeLegCost({ legIndex: 1, consumptionL100km: 31.2, loadRatio: 0.8 }),
      makeLegCost({ legIndex: 2, consumptionL100km: 22.1, loadRatio: 0.45 }),
    ];
    const data = makeBreakdown({ stopCount: 2, legCosts });

    render(<ProfitWaterfall data={data} />);

    expect(screen.getAllByTestId("waterfall-bar")).toHaveLength(7);

    const toggle = screen.getByRole("switch", { name: "Spalanie per odcinek" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "true");
    const legBars = screen.getAllByTestId("leg-consumption-bar");
    expect(legBars).toHaveLength(legCosts.length);
    expect(screen.getByText("Leg 1")).toBeInTheDocument();
    expect(screen.getByText("Leg 3")).toBeInTheDocument();
    expect(legBars[0]).toHaveAttribute(
      "data-fill",
      getLegColorByRatio(0.1),
    );
    expect(legBars[1]).toHaveAttribute(
      "data-fill",
      getLegColorByRatio(0.8),
    );
    expect(lastBarProps).toMatchObject({
      dataKey: "consumptionL100km",
      animationDuration: 400,
      isAnimationActive: true,
    });

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getAllByTestId("waterfall-bar")).toHaveLength(7);
    expect(lastBarProps).toMatchObject({
      dataKey: "range",
      animationDuration: 400,
      isAnimationActive: true,
    });
  });

  it("shows message instead of chart when per-leg view has no leg_costs", async () => {
    const user = userEvent.setup();
    stubLoadStore({ "slot-a": { offerId: "offer-1" } });
    const data = makeBreakdown({ stopCount: 2, legCosts: [] });

    render(<ProfitWaterfall data={data} />);

    await user.click(screen.getByRole("switch", { name: "Spalanie per odcinek" }));

    expect(
      screen.getByText(/Brak danych odcinków — zoptymalizuj trasę/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
  });

  it("maps leg_costs through buildLegConsumptionData for per-leg bars", async () => {
    const user = userEvent.setup();
    stubLoadStore({ "slot-a": { offerId: "offer-1" } });
    const legCosts = [
      makeLegCost({ legIndex: 0, consumptionL100km: 19.2, loadRatio: 0.2 }),
      makeLegCost({ legIndex: 1, consumptionL100km: 27.8, loadRatio: 0.7 }),
    ];
    const data = makeBreakdown({ stopCount: 2, legCosts });

    render(<ProfitWaterfall data={data} />);
    await user.click(screen.getByRole("switch", { name: "Spalanie per odcinek" }));

    const expected = buildLegConsumptionData(legCosts).map((row) => row.key);
    const rendered = screen
      .getAllByTestId("leg-consumption-bar")
      .map((node) => node.getAttribute("data-bar-key"));

    expect(rendered).toEqual(expected);
  });
});
