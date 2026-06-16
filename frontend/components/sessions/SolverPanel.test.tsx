/**
 * SolverPanel.test.tsx — Tasks 5.1–5.4.
 *
 * Pokrycie:
 *   - Live timer (izolowany SolverElapsedTimer) — +1s co sekundę.
 *   - Maszyna stanów: uruchomienie → wynik, anulowanie (DELETE + idle), AbortError.
 *   - Diff: trzy sekcje added/removed/unchanged + badge PRZYBLIŻONY.
 *   - Apply: PUT /offers przed mutacją store, błąd PUT → toast bez zmiany UI.
 *   - Discard: reset bez wywołań API.
 *   - Disabled gdy status sesji !== draft.
 *
 * Strategia mocków: global.fetch (jak VehicleSelector.test), useToast i store'y.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { OfferDiffRow, SolverElapsedTimer, SolverPanel } from "./SolverPanel";

// ─── Mock Toast ───────────────────────────────────────────────────────────────

const mockShowToast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

// ─── Mock store'ów ────────────────────────────────────────────────────────────

const mockApplyBulkOffers = vi.fn();
const mockSetLoadSessionId = vi.fn();
const mockSetStoreSessionId = vi.fn();

vi.mock("@/lib/stores/vehicleStore", () => ({
  useVehicleStore: (selector: (s: unknown) => unknown) =>
    selector({ sessionOrigin: null, fleetVehicleId: null }),
}));

vi.mock("@/lib/stores/sessionStore", () => ({
  useSessionStore: (selector: (s: unknown) => unknown) =>
    selector({ setSessionId: mockSetStoreSessionId }),
}));

vi.mock("@/lib/stores/loadStore", () => ({
  useLoadStore: {
    getState: () => ({
      applyBulkOffers: mockApplyBulkOffers,
      setSessionId: mockSetLoadSessionId,
    }),
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_ID = "11111111-1111-4111-8111-111111110001";

function makeDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    status: "draft",
    created_at: "2026-01-01T00:00:00Z",
    vehicle: { id: "v1", name: "Truck", type: "man_solo" },
    driver_profile: {
      id: "dp1",
      code: "STD",
      name: "Standard",
      hourly_cost_eur: 20,
      idle_fuel_l_per_hour: 2,
      stop_admin_fee_eur: 5,
    },
    offers: [
      { id: "a", price_eur: 100, ldm: 1, weight_kg: 200 },
      { id: "b", price_eur: 120, ldm: 1.2, weight_kg: 240 },
    ],
    stops: [],
    metrics: {
      used_ldm: 2,
      fill_pct: 0.3,
      used_weight_kg: 440,
      weight_pct: 0.1,
      total_distance_km: 100,
      estimated_net_profit_eur: 50,
      stop_count: 2,
      client_count: 2,
      stop_costs_eur: 10,
    },
    ...overrides,
  };
}

function makeRunResult(overrides: Record<string, unknown> = {}) {
  return {
    session_id: SESSION_ID,
    solver_run_id: "run-1",
    selected_offer_ids: ["a", "b", "c"],
    objective_value: 1500,
    solver_status: "OPTIMAL",
    is_optimal: true,
    solve_time_ms: 5000,
    current_offer_ids: ["a"],
    ...overrides,
  };
}

function okJson(data: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(data) } as Response;
}

function errJson(status: number, data: unknown = {}): Response {
  return { ok: false, status, json: () => Promise.resolve(data) } as Response;
}

interface FetchConfig {
  detail?: Record<string, unknown>;
  runResult?: Record<string, unknown>;
  /** "immediate" resolves the optimize POST with a result; "hang" waits for abort. */
  optimize?: "immediate" | "hang";
  putStatus?: number;
}

let fetchSpy: ReturnType<typeof vi.fn>;

function installFetch(config: FetchConfig = {}) {
  const {
    detail = makeDetail(),
    runResult = makeRunResult(),
    optimize = "immediate",
    putStatus = 200,
  } = config;

  fetchSpy = vi.fn((url: string, options?: RequestInit) => {
    const method = options?.method ?? "GET";

    if (url.includes("/optimize")) {
      if (method === "DELETE") {
        return Promise.resolve(okJson(makeRunResult()));
      }
      // POST /optimize
      if (optimize === "hang") {
        return new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }
      return Promise.resolve(
        okJson({
          status: "DONE",
          elapsed_ms: 5000,
          best_objective: 1500,
          result: runResult,
        }),
      );
    }

    if (url.includes("/offers")) {
      // PUT /offers
      if (putStatus !== 200) {
        return Promise.resolve(errJson(putStatus, { detail: "PUT failed" }));
      }
      return Promise.resolve(okJson(makeDetail()));
    }

    if (url.endsWith("/api/v1/sessions") && method === "POST") {
      return Promise.resolve(okJson({ id: "temp-session-id", status: "draft" }));
    }

    if (url.includes("/api/v1/sessions/")) {
      // GET session detail
      return Promise.resolve(okJson(detail));
    }

    return Promise.reject(new Error(`Unmocked URL: ${url}`));
  });

  vi.stubGlobal("fetch", fetchSpy);
}

async function renderPanel(props: Partial<ComponentProps<typeof SolverPanel>> = {}) {
  let utils: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<SolverPanel sessionId={SESSION_ID} {...props} />);
  });
  // Wait for the initial fetchSessionDetail() effect to settle.
  await waitFor(() =>
    expect(screen.getByTestId("solver-panel")).toBeInTheDocument(),
  );
  return utils!;
}

async function runOptimize() {
  const btn = await screen.findByTestId("solver-optimize-btn");
  await act(async () => {
    fireEvent.click(btn);
  });
  await screen.findByTestId("diff-added");
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockShowToast.mockClear();
  mockApplyBulkOffers.mockClear();
  mockSetLoadSessionId.mockClear();
  mockSetStoreSessionId.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ─── SolverElapsedTimer (5.1) ───────────────────────────────────────────────────

describe("SolverElapsedTimer", () => {
  it("rośnie o +1s co sekundę", () => {
    vi.useFakeTimers();
    render(<SolverElapsedTimer />);

    expect(screen.getByTestId("solver-timer")).toHaveTextContent("0:00");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId("solver-timer")).toHaveTextContent("0:01");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId("solver-timer")).toHaveTextContent("0:02");
  });

  it("formatuje minuty i sekundy z paddingiem", () => {
    vi.useFakeTimers();
    render(<SolverElapsedTimer />);

    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByTestId("solver-timer")).toHaveTextContent("1:05");
  });
});

// ─── OfferDiffRow (5.2) ─────────────────────────────────────────────────────────

describe("OfferDiffRow", () => {
  it("added → zielone tło", () => {
    render(
      <ul>
        <OfferDiffRow id="x" label="#X" tone="added" rowTestId="diff-added-row" />
      </ul>,
    );
    expect(screen.getByTestId("diff-added-row")).toHaveClass("bg-green-50");
  });

  it("removed → czerwone tło + line-through", () => {
    render(
      <ul>
        <OfferDiffRow id="x" label="#X" tone="removed" rowTestId="diff-removed-row" />
      </ul>,
    );
    const row = screen.getByTestId("diff-removed-row");
    expect(row).toHaveClass("bg-red-50");
    expect(row).toHaveClass("line-through");
  });

  it("unchanged → opacity-50", () => {
    render(
      <ul>
        <OfferDiffRow
          id="x"
          label="#X"
          tone="unchanged"
          rowTestId="diff-unchanged-row"
        />
      </ul>,
    );
    expect(screen.getByTestId("diff-unchanged-row")).toHaveClass("opacity-50");
  });
});

// ─── SolverPanel — uruchamianie i wynik (5.1 / 5.2) ─────────────────────────────

describe("SolverPanel — run + diff", () => {
  it("renderuje tytuł i przycisk Optymalizuj załadunek w draft", async () => {
    installFetch();
    await renderPanel();

    expect(screen.getByText("Solver VRP")).toBeInTheDocument();
    const btn = await screen.findByTestId("solver-optimize-btn");
    expect(btn).toHaveTextContent("Optymalizuj załadunek");
  });

  it("Optymalizuj → renderuje trzy sekcje diff i badge OPTIMAL", async () => {
    installFetch();
    await renderPanel();
    await runOptimize();

    expect(screen.getByTestId("diff-added")).toBeInTheDocument();
    expect(screen.getByTestId("diff-removed")).toBeInTheDocument();
    expect(screen.getByTestId("diff-unchanged")).toBeInTheDocument();

    // current ["a"] vs selected ["a","b","c"] → added b,c · unchanged a
    const added = screen.getByTestId("diff-added");
    expect(within(added).getAllByTestId("diff-added-row")).toHaveLength(2);
    expect(screen.getByTestId("diff-added")).toHaveAttribute("data-count", "2");
    expect(screen.getByTestId("diff-unchanged")).toHaveAttribute("data-count", "1");

    expect(screen.getByText("OPTIMAL")).toBeInTheDocument();
    expect(screen.queryByTestId("solver-approx-badge")).not.toBeInTheDocument();
  });

  it("badge PRZYBLIŻONY widoczny tylko gdy is_optimal === false", async () => {
    installFetch({ runResult: makeRunResult({ solver_status: "FEASIBLE", is_optimal: false }) });
    await renderPanel();
    await runOptimize();

    expect(screen.getByTestId("solver-approx-badge")).toHaveTextContent("PRZYBLIŻONY");
    expect(screen.getByText("FEASIBLE")).toBeInTheDocument();
  });

  it("używa offerLabels w wierszach diff gdy podane", async () => {
    installFetch();
    await renderPanel({ offerLabels: { b: "Warszawa → Kraków" } });
    await runOptimize();

    expect(screen.getByText("Warszawa → Kraków")).toBeInTheDocument();
  });
});

// ─── SolverPanel — anulowanie (5.1) ─────────────────────────────────────────────

describe("SolverPanel — anulowanie", () => {
  it("Anuluj woła DELETE /optimize i wraca do idle (AbortError nie ustawia error)", async () => {
    installFetch({ optimize: "hang" });
    await renderPanel();

    const optimizeBtn = await screen.findByTestId("solver-optimize-btn");
    await act(async () => {
      fireEvent.click(optimizeBtn);
    });

    // Running: timer + cancel widoczne.
    expect(await screen.findByTestId("solver-cancel-btn")).toBeInTheDocument();
    expect(screen.getByTestId("solver-timer")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("solver-cancel-btn"));
    });

    // Powrót do idle — przycisk Optymalizuj znowu widoczny, brak diff.
    await waitFor(() =>
      expect(screen.getByTestId("solver-optimize-btn")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("diff-added")).not.toBeInTheDocument();

    const deleteCall = fetchSpy.mock.calls.find(
      ([url, opts]) =>
        String(url).includes("/optimize") &&
        (opts as RequestInit | undefined)?.method === "DELETE",
    );
    expect(deleteCall).toBeTruthy();
    expect(mockShowToast).toHaveBeenCalledWith({
      type: "info",
      message: "Optymalizacja anulowana.",
    });
  });
});

// ─── SolverPanel — Zastosuj (5.3) ───────────────────────────────────────────────

describe("SolverPanel — Zastosuj", () => {
  it("PUT /offers z wybranymi ofertami, optimistic store update i onApplied", async () => {
    installFetch();
    const onApplied = vi.fn();
    await renderPanel({ onApplied });
    await runOptimize();

    await act(async () => {
      fireEvent.click(screen.getByTestId("solver-apply-btn"));
    });

    await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());

    const putCall = fetchSpy.mock.calls.find(
      ([url, opts]) =>
        String(url).includes("/offers") &&
        (opts as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCall).toBeTruthy();
    const body = JSON.parse((putCall![1] as RequestInit).body as string);
    expect(body).toEqual({ offer_ids: ["a", "b", "c"] });

    expect(mockApplyBulkOffers).toHaveBeenCalledWith(["a", "b", "c"]);
    expect(mockShowToast).toHaveBeenCalledWith({
      type: "success",
      message: "Propozycja solvera zastosowana.",
    });
    // Po zastosowaniu UI wraca do idle (diff znika).
    await waitFor(() =>
      expect(screen.queryByTestId("diff-added")).not.toBeInTheDocument(),
    );
  });

  it("błąd PUT → toast error, brak mutacji store i diff pozostaje", async () => {
    installFetch({ putStatus: 500 });
    const onApplied = vi.fn();
    await renderPanel({ onApplied });
    await runOptimize();

    await act(async () => {
      fireEvent.click(screen.getByTestId("solver-apply-btn"));
    });

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error" }),
      ),
    );

    expect(mockApplyBulkOffers).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
    // Brak częściowej aktualizacji — diff nadal widoczny.
    expect(screen.getByTestId("diff-added")).toBeInTheDocument();
    expect(screen.getByTestId("solver-apply-btn")).toBeInTheDocument();
  });
});

// ─── SolverPanel — Odrzuć (5.3) ─────────────────────────────────────────────────

describe("SolverPanel — Odrzuć", () => {
  it("resetuje UI bez żadnego wywołania API ofert", async () => {
    installFetch();
    await renderPanel();
    await runOptimize();

    const callsBefore = fetchSpy.mock.calls.length;

    await act(async () => {
      fireEvent.click(screen.getByTestId("solver-reject-btn"));
    });

    await waitFor(() =>
      expect(screen.queryByTestId("diff-added")).not.toBeInTheDocument(),
    );

    // Żadnych nowych wywołań PUT/DELETE po odrzuceniu.
    const newCalls = fetchSpy.mock.calls.slice(callsBefore);
    expect(
      newCalls.some(([url, opts]) => {
        const method = (opts as RequestInit | undefined)?.method;
        return (
          (method === "PUT" && String(url).includes("/offers")) ||
          (method === "DELETE" && String(url).includes("/optimize"))
        );
      }),
    ).toBe(false);
    expect(mockShowToast).toHaveBeenCalledWith({
      type: "success",
      message: "Propozycja odrzucona — układ bez zmian.",
    });
    expect(screen.getByTestId("solver-optimize-btn")).toBeInTheDocument();
  });
});

// ─── SolverPanel — status sesji (5.1 / 5.4) ─────────────────────────────────────

describe("SolverPanel — disabled gdy nie draft", () => {
  it("ukrywa przycisk Optymalizuj gdy sesja jest confirmed", async () => {
    installFetch({ detail: makeDetail({ status: "confirmed" }) });
    await renderPanel();

    await waitFor(() =>
      expect(screen.queryByTestId("solver-optimize-btn")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Trasa jest zatwierdzona/),
    ).toBeInTheDocument();
  });
});

// ─── SolverPanel — błędy i INFEASIBLE (5.1 / 5.2) ───────────────────────────────

describe("SolverPanel — błędy solvera", () => {
  it("błąd POST /optimize → toast error i brak diff (stan error)", async () => {
    fetchSpy = vi.fn((url: string, options?: RequestInit) => {
      const method = options?.method ?? "GET";
      if (url.includes("/optimize")) {
        return Promise.resolve(errJson(500, { detail: "solver down" }));
      }
      if (url.includes("/api/v1/sessions/")) {
        return Promise.resolve(okJson(makeDetail()));
      }
      return Promise.reject(new Error(`Unmocked URL: ${url}`));
    });
    vi.stubGlobal("fetch", fetchSpy);

    await renderPanel();
    await act(async () => {
      fireEvent.click(await screen.findByTestId("solver-optimize-btn"));
    });

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error" }),
      ),
    );
    expect(screen.queryByTestId("diff-added")).not.toBeInTheDocument();
    // Po błędzie można spróbować ponownie.
    expect(screen.getByTestId("solver-optimize-btn")).toBeInTheDocument();
  });

  it("INFEASIBLE → toast error i brak przycisku Zastosuj", async () => {
    installFetch({
      runResult: makeRunResult({
        solver_status: "INFEASIBLE",
        is_optimal: false,
        selected_offer_ids: [],
        current_offer_ids: ["a"],
      }),
    });
    await renderPanel();
    await act(async () => {
      fireEvent.click(await screen.findByTestId("solver-optimize-btn"));
    });

    await screen.findByTestId("diff-removed");
    expect(screen.getByText("INFEASIBLE")).toBeInTheDocument();
    expect(screen.queryByTestId("solver-apply-btn")).not.toBeInTheDocument();
    expect(screen.getByTestId("solver-reject-btn")).toBeInTheDocument();
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" }),
    );
  });
});

// ─── SolverPanel — tryb pre-session (5.3 / 5.4) ─────────────────────────────────

describe("SolverPanel — pre-session", () => {
  it("tworzy sesję tymczasową, optymalizuje i promuje sesję przy Zastosuj", async () => {
    installFetch();
    const onApplied = vi.fn();
    const onOffersPlaced = vi.fn();

    await act(async () => {
      render(
        <SolverPanel
          sessionId={null}
          vehicleId="v1"
          onApplied={onApplied}
          onOffersPlaced={onOffersPlaced}
        />,
      );
    });

    await act(async () => {
      fireEvent.click(await screen.findByTestId("solver-optimize-btn"));
    });
    await screen.findByTestId("diff-added");

    // createSession został wywołany (POST /api/v1/sessions bez id).
    const createCall = fetchSpy.mock.calls.find(
      ([url, opts]) =>
        String(url).endsWith("/api/v1/sessions") &&
        (opts as RequestInit | undefined)?.method === "POST",
    );
    expect(createCall).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId("solver-apply-btn"));
    });

    await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
    expect(onOffersPlaced).toHaveBeenCalledWith(["a", "b", "c"]);
    expect(mockSetStoreSessionId).toHaveBeenCalledWith("temp-session-id");
    expect(mockSetLoadSessionId).toHaveBeenCalledWith("temp-session-id");
  });

  it("bez pojazdu i bez sesji nie renderuje panelu", () => {
    installFetch();
    const { container } = render(<SolverPanel sessionId={null} vehicleId={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
