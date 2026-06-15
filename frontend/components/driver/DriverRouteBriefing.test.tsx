import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DriverRouteBriefing } from "@/components/driver/DriverRouteBriefing";
import { ToastProvider } from "@/components/ui/Toast";

const ROUTE_MAP_RESPONSE = {
  session_id: "sess-1",
  origin: { lat: 52.22, lon: 21.01 },
  vehicle_max_weight_kg: 24000,
  total_distance_km: 96.4,
  total_duration_minutes: 142,
  legs: [],
  stops: [
    {
      id: "s1",
      offer_id: "o1",
      stop_type: "pickup",
      sequence_order: 0,
      location: { lat: 52.18, lon: 20.85 },
      eta_minutes_from_start: 45,
      stop_cost_eur: 28,
      address_label: "Odbiór · Warszawa",
      handling_time_minutes: 30,
      is_current: true,
    },
    {
      id: "s2",
      offer_id: "o1",
      stop_type: "delivery",
      sequence_order: 1,
      location: { lat: 51.95, lon: 20.55 },
      eta_minutes_from_start: 120,
      stop_cost_eur: 32,
      address_label: "Dostawa · Łódź",
      handling_time_minutes: 25,
      is_current: false,
    },
  ],
};

const SESSION_DETAIL_RESPONSE = {
  id: "sess-1",
  status: "confirmed",
  created_at: "2026-06-15T08:00:00.000Z",
  vehicle: { id: "v1", name: "MAN Solówka", type: "man_solo" },
  driver_profile: { id: "d1", code: "std", name: "Jan Kowalski" },
  offers: [],
  stops: [],
  metrics: {},
};

interface MockOptions {
  routeMapOk?: boolean;
  emptyStops?: boolean;
}

function mockFetch(options: MockOptions = {}) {
  const { routeMapOk = true, emptyStops = false } = options;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/route-map")) {
        if (!routeMapOk) {
          return Promise.resolve({ ok: false, status: 500 } as Response);
        }
        const body = emptyStops
          ? { ...ROUTE_MAP_RESPONSE, stops: [] }
          : ROUTE_MAP_RESPONSE;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(body),
        } as Response);
      }
      if (url.includes("/api/v1/sessions/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(SESSION_DETAIL_RESPONSE),
        } as Response);
      }
      return Promise.reject(new Error(`Unmocked URL: ${url}`));
    }),
  );
}

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  writeText.mockClear();
  Object.assign(navigator, {
    clipboard: { writeText },
  });
  // Default: no Web Share API → share falls back to copy.
  // @ts-expect-error allow deleting optional API in jsdom
  delete navigator.share;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderBriefing(variant: "compact" | "full" = "full") {
  return render(
    <ToastProvider>
      <DriverRouteBriefing sessionId="sess-1" variant={variant} />
    </ToastProvider>,
  );
}

async function renderAndWait(variant: "compact" | "full" = "full") {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = renderBriefing(variant);
  });
  await waitFor(() =>
    expect(screen.getByTestId("driver-route-briefing")).toBeInTheDocument(),
  );
  return result!;
}

describe("DriverRouteBriefing", () => {
  it("renders a preview with stop data in full variant", async () => {
    mockFetch();
    await renderAndWait("full");

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /kopiuj plan trasy/i }),
      ).toBeInTheDocument();
    });

    const preview = screen.getByLabelText("Podgląd planu trasy") as HTMLTextAreaElement;
    expect(preview.value).toContain("Kierowca: Jan Kowalski");
    expect(preview.value).toContain("GPS: 52.18000, 20.85000");
  });

  it("copies the briefing to the clipboard", async () => {
    mockFetch();
    await renderAndWait("full");

    const copyButton = await screen.findByRole("button", {
      name: /kopiuj plan trasy/i,
    });
    await act(async () => {
      copyButton.click();
    });

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledOnce();
    });
    expect(writeText.mock.calls[0][0]).toContain("PLAN TRASY");
  });

  it("falls back to clipboard when Web Share API is unavailable", async () => {
    mockFetch();
    await renderAndWait("full");

    const shareButton = await screen.findByRole("button", {
      name: /udostępnij plan trasy/i,
    });
    await act(async () => {
      shareButton.click();
    });

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledOnce();
    });
  });

  it("uses navigator.share when available", async () => {
    mockFetch();
    const share = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { share });

    await renderAndWait("full");

    const shareButton = await screen.findByRole("button", {
      name: /udostępnij plan trasy/i,
    });
    await act(async () => {
      shareButton.click();
    });

    await waitFor(() => {
      expect(share).toHaveBeenCalledOnce();
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("shows a readable message when there are no stops", async () => {
    mockFetch({ emptyStops: true });
    await renderAndWait("full");

    await waitFor(() => {
      expect(screen.getByTestId("driver-route-briefing")).toHaveTextContent(
        /brak postojów/i,
      );
    });
    expect(
      screen.queryByRole("button", { name: /kopiuj plan trasy/i }),
    ).not.toBeInTheDocument();
  });

  it("shows an error message when the route map request fails", async () => {
    mockFetch({ routeMapOk: false });
    await renderAndWait("full");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  it("hides the preview textarea in compact variant", async () => {
    mockFetch();
    await renderAndWait("compact");

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /kopiuj plan trasy/i }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("Podgląd planu trasy")).not.toBeInTheDocument();
  });
});
