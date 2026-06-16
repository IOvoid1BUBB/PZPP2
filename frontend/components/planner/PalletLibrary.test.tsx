/**
 * PalletLibrary.test.tsx
 *
 * Testy ScoreBar, OfferRow i PalletLibrary — fetch, optimistic add, filtry URL,
 * wirtualizacja i obsługa błędu 409 insufficient_ldm.
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

import {
  OfferRow,
  PalletLibrary,
  ScoreBar,
} from "./PalletLibrary";
import type { RankedOfferRow } from "@/lib/types/offers";

// ─── Mock next/navigation ───────────────────────────────────────────────────

const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/planner",
  useSearchParams: () => mockSearchParams,
}));

// ─── Mock Toast ───────────────────────────────────────────────────────────────

const mockShowToast = vi.fn();

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

// ─── Mock @dnd-kit/core ──────────────────────────────────────────────────────

vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    isDragging: false,
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SESSION_ID = "session-test-uuid";

function makeOffer(overrides: Partial<RankedOfferRow> = {}): RankedOfferRow {
  return {
    offer_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    total_score: 0.5,
    revenue_density_score: 0.25,
    detour_penalty_score: 0.25,
    fill_contribution_score: 0.25,
    time_window_score: 0.25,
    added_km: 50,
    estimated_added_cost_eur: 100,
    ldm: 2.5,
    weight_kg: 500,
    price_eur: 300,
    stackable: true,
    pickup_label: "Warszawa",
    delivery_label: "Kraków",
    ...overrides,
  };
}

function makeApiRecord(overrides: Record<string, unknown> = {}) {
  return {
    offer_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    total_score: 0.5,
    revenue_density_score: 0.25,
    detour_penalty_score: 0.25,
    fill_contribution_score: 0.25,
    time_window_score: 0.25,
    added_km: 50,
    estimated_added_cost_eur: 100,
    ldm: 2.5,
    weight_kg: 500,
    price_eur: 300,
    stackable: true,
    pickup_label: "Warszawa",
    delivery_label: "Kraków",
    ...overrides,
  };
}

function rankedOffersResponse(offers: Record<string, unknown>[]) {
  return {
    session_id: SESSION_ID,
    limit: 50,
    scored_count: offers.length,
    offers,
  };
}

type FetchHandler = (
  url: string,
  options?: RequestInit,
) => Response | Promise<Response>;

function mockFetch(handler: FetchHandler) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, options?: RequestInit) => Promise.resolve(handler(url, options))),
  );
}

function defaultFetchHandler(
  offers: Record<string, unknown>[] = [makeApiRecord()],
  postHandler?: (offerId: string) => Response | Promise<Response>,
): FetchHandler {
  return (url, options) => {
    if (url.includes("/ranked-offers")) {
      return {
        ok: true,
        json: () => Promise.resolve(rankedOffersResponse(offers)),
      } as Response;
    }

    if (url.includes("/offers/") && options?.method === "POST") {
      const offerId = url.split("/offers/")[1] ?? "";
      if (postHandler) {
        return postHandler(offerId);
      }
      return {
        ok: true,
        json: () => Promise.resolve({ id: SESSION_ID, status: "draft" }),
      } as Response;
    }

    throw new Error(`Unmocked URL: ${url}`);
  };
}

async function renderLibrary(
  props: Partial<ComponentProps<typeof PalletLibrary>> = {},
) {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <PalletLibrary sessionId={SESSION_ID} {...props} />,
    );
  });
  await waitFor(() => {
    expect(screen.queryByText("Wczytywanie ofert…")).not.toBeInTheDocument();
  });
  return result!;
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockReplace.mockClear();
  mockShowToast.mockClear();
  mockSearchParams = new URLSearchParams();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── ScoreBar ─────────────────────────────────────────────────────────────────

describe("ScoreBar", () => {
  it("renderuje 4 segmenty z poprawnymi kolorami i aria-label", () => {
    const score = makeOffer({
      total_score: 0.82,
      revenue_density_score: 0.3,
      detour_penalty_score: 0.2,
      fill_contribution_score: 0.15,
      time_window_score: 0.17,
    });

    const { container } = render(<ScoreBar score={score} />);

    const bar = screen.getByRole("img", { name: "Score 0.82" });
    expect(bar).toBeInTheDocument();

    const segments = container.querySelectorAll(".score-bar__segment");
    expect(segments).toHaveLength(4);
    expect(segments[0]).toHaveStyle({ backgroundColor: "#1D9E75" });
    expect(segments[1]).toHaveStyle({ backgroundColor: "#534AB7" });
    expect(segments[2]).toHaveStyle({ backgroundColor: "#F5A623" });
    expect(segments[3]).toHaveStyle({ backgroundColor: "#E8564A" });
  });

  it("używa Math.max(0, detour_penalty_score) dla segmentu detour", () => {
    const score = makeOffer({
      total_score: 0.4,
      revenue_density_score: 0.4,
      detour_penalty_score: -0.1,
      fill_contribution_score: 0.3,
      time_window_score: 0.3,
    });

    const { container } = render(<ScoreBar score={score} />);
    const segments = container.querySelectorAll(".score-bar__segment");
    expect(segments[1]).toHaveStyle({ flex: "2" });
  });
});

// ─── OfferRow badges ──────────────────────────────────────────────────────────

describe("OfferRow — badge", () => {
  it("pokazuje POLECANE gdy total_score > 0.75", () => {
    render(
      <OfferRow
        offer={makeOffer({ total_score: 0.8 })}
        isLoading={false}
        isLoaded={false}
      />,
    );
    expect(screen.getByText("POLECANE")).toBeInTheDocument();
  });

  it("pokazuje ODRADZONE gdy total_score < 0.20", () => {
    render(
      <OfferRow
        offer={makeOffer({ total_score: 0.15 })}
        isLoading={false}
        isLoaded={false}
      />,
    );
    expect(screen.getByText("ODRADZONE")).toBeInTheDocument();
  });

  it("pokazuje NA TRASIE gdy added_km < 10 i brak wyższego priorytetu", () => {
    render(
      <OfferRow
        offer={makeOffer({ total_score: 0.5, added_km: 5 })}
        isLoading={false}
        isLoaded={false}
      />,
    );
    expect(screen.getByText("NA TRASIE")).toBeInTheDocument();
  });

  it("pokazuje Ładuje… gdy isLoading=true (najwyższy priorytet)", () => {
    render(
      <OfferRow
        offer={makeOffer({ total_score: 0.8 })}
        isLoading
        isLoaded={false}
      />,
    );
    expect(screen.getByText("Ładuje…")).toBeInTheDocument();
    expect(screen.queryByText("POLECANE")).not.toBeInTheDocument();
  });

  it("pokazuje Załadowano gdy isLoaded=true", () => {
    render(
      <OfferRow
        offer={makeOffer({ total_score: 0.5 })}
        isLoading={false}
        isLoaded
      />,
    );
    expect(screen.getByText("Załadowano")).toBeInTheDocument();
  });
});

// ─── PalletLibrary ────────────────────────────────────────────────────────────

describe("PalletLibrary", () => {
  it("pobiera ranked-offers przy mount i renderuje karty", async () => {
    mockFetch(defaultFetchHandler([makeApiRecord({ offer_id: "offer-1" })]));

    await renderLibrary();

    expect(screen.getByText("Warszawa → Kraków")).toBeInTheDocument();
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
  });

  it("klik Dodaj → natychmiast Ładuje… → sukces → Załadowano", async () => {
    let resolvePost!: (value: Response) => void;
    const postDeferred = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });

    mockFetch((url, options) => {
      if (url.includes("/ranked-offers")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve(
              rankedOffersResponse([
                makeApiRecord({ offer_id: "offer-add-1", total_score: 0.5 }),
              ]),
            ),
        } as Response;
      }
      if (url.includes("/offers/") && options?.method === "POST") {
        return postDeferred;
      }
      throw new Error(`Unmocked URL: ${url}`);
    });

    const onOfferAdded = vi.fn();
    await renderLibrary({ onOfferAdded });

    const addButton = screen.getByRole("button", { name: "Dodaj" });
    await act(async () => {
      fireEvent.click(addButton);
    });

    expect(screen.getByText("Ładuje…")).toBeInTheDocument();

    await act(async () => {
      resolvePost({
        ok: true,
        json: () => Promise.resolve({ id: SESSION_ID, status: "draft" }),
      } as Response);
      await postDeferred;
    });

    await waitFor(() => {
      expect(screen.getByText("Załadowano")).toBeInTheDocument();
    });
    expect(onOfferAdded).toHaveBeenCalledOnce();
    expect(screen.queryByText("Ładuje…")).not.toBeInTheDocument();
  });

  it("409 insufficient_ldm → toast z free_ldm i rollback bez Załadowano", async () => {
    mockFetch(
      defaultFetchHandler(
        [makeApiRecord({ offer_id: "offer-ldm-1", total_score: 0.5 })],
        () =>
          ({
            ok: false,
            status: 409,
            json: () =>
              Promise.resolve({
                error: "insufficient_ldm",
                detail: "Not enough LDM",
                free_ldm: 2.5,
              }),
          }) as Response,
      ),
    );

    await renderLibrary();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dodaj" }));
    });

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith({
        type: "error",
        message: "Brak LDM — wolne: 2.5 LDM",
      });
    });
    expect(screen.queryByText("Załadowano")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dodaj" })).toBeInTheDocument();
  });

  it("zmiana max_detour wywołuje router.replace z query", async () => {
    mockFetch(defaultFetchHandler());

    await renderLibrary();

    const slider = screen.getByRole("slider", { name: /max detour/i });
    await act(async () => {
      fireEvent.change(slider, { target: { value: "100" } });
    });

    expect(mockReplace).toHaveBeenCalledWith("/planner?max_detour=100", {
      scroll: false,
    });
  });

  it("odczytuje filtry z URL (max_detour, min_score, stackable)", async () => {
    mockSearchParams = new URLSearchParams(
      "stackable=true&max_detour=80&min_score=0.5",
    );
    mockFetch(
      defaultFetchHandler([
        makeApiRecord({
          offer_id: "low-score",
          total_score: 0.3,
          stackable: true,
          added_km: 50,
        }),
        makeApiRecord({
          offer_id: "high-score",
          total_score: 0.7,
          stackable: true,
          added_km: 50,
        }),
      ]),
    );

    await renderLibrary();

    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.queryByText(/#LOW-SCOR/i)).not.toBeInTheDocument();
  });

  it("renderuje wirtualizowaną listę gdy >50 ofert po filtrach", async () => {
    const manyOffers = Array.from({ length: 51 }, (_, index) =>
      makeApiRecord({
        offer_id: `offer-${String(index).padStart(8, "0")}-aaaa-bbbb-cccc-dddddddddddd`,
        total_score: 0.5,
        added_km: 20,
      }),
    );
    mockFetch(defaultFetchHandler(manyOffers));

    await renderLibrary();

    expect(screen.getByTestId("pallet-library-virtual-list")).toBeInTheDocument();
    expect(screen.getByText("51 / 51")).toBeInTheDocument();
  });

  it("pokazuje komunikat gdy filtry nie zwracają ofert", async () => {
    mockSearchParams = new URLSearchParams("min_score=0.99");
    mockFetch(
      defaultFetchHandler([
        makeApiRecord({ total_score: 0.5 }),
      ]),
    );

    await renderLibrary();

    expect(
      screen.getByText("Brak ofert dla wybranych filtrów."),
    ).toBeInTheDocument();
  });

  it("pokazuje błąd fetch gdy API zwróci błąd", async () => {
    mockFetch(() => ({ ok: false, status: 500 }) as Response);

    await act(async () => {
      render(<PalletLibrary sessionId={SESSION_ID} />);
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Nie udało się pobrać ofert/i,
      );
    });
  });

  it("filtr stackable client-side ukrywa niestackowalne oferty", async () => {
    mockSearchParams = new URLSearchParams("stackable=true");
    mockFetch(
      defaultFetchHandler([
        makeApiRecord({ offer_id: "stackable-offer", stackable: true }),
        makeApiRecord({ offer_id: "non-stack-offer", stackable: false }),
      ]),
    );

    await renderLibrary();

    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    const aside = screen.getByRole("complementary", { name: "Biblioteka ofert" });
    expect(within(aside).getByText(/#STACKABL/i)).toBeInTheDocument();
    expect(within(aside).queryByText(/#NON-STACK/i)).not.toBeInTheDocument();
  });

  it("rejestruje addOffer przez onRegisterAddOffer", async () => {
    mockFetch(defaultFetchHandler());
    const onRegisterAddOffer = vi.fn();

    await renderLibrary({ onRegisterAddOffer });

    expect(onRegisterAddOffer).toHaveBeenCalledWith(expect.any(Function));
  });
});
