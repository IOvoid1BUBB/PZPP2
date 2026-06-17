/**
 * VehicleHeader.dispatch.test.tsx
 *
 * Testy integracyjne przycisku „Wyślij do kierowcy" (Zatwierdź trasę).
 *
 * Pokrywają zachowanie walidacji biznesowej (lib/load/dispatchValidation) wpiętej
 * w realny system powiadomień (Toast) oraz w realny przycisk z VehicleHeader:
 *   - pusta naczepa → blokada + Toast,
 *   - konflikty ułożenia → blokada + Toast,
 *   - poprawny plan → PATCH status="confirmed" + przejście w tryb read-only.
 *
 * Strategia mocków: tylko warstwa sieciowa (sessionClient). Walidacja, Toast
 * oraz VehicleHeader są prawdziwe — to czyni test integracyjnym, nie jednostkowym.
 */

import { useMemo, useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, ToastViewport, useToast } from "@/components/ui/Toast";
import { VehicleHeader } from "@/components/planner/VehicleHeader";
import { validateDispatch } from "@/lib/load/dispatchValidation";
import type { SlotConflict } from "@/lib/types/load";

const updateSessionStatusMock = vi.fn();

vi.mock("@/lib/api/sessionClient", () => ({
  fetchDriverProfiles: vi.fn(() => Promise.resolve([])),
  updateSessionStatus: (...args: unknown[]) => updateSessionStatusMock(...args),
}));

const SESSION_ID = "11111111-1111-4111-8111-111111110099";

/**
 * Harness odwzorowujący wiring z SlotEditor: walidacja → Toast → PATCH → read-only.
 */
function DispatchHarness({
  conflicts,
  usedLdm,
}: {
  conflicts: SlotConflict[];
  usedLdm: number;
}) {
  const { showToast } = useToast();
  const [status, setStatus] = useState("draft");

  const routeMode = useMemo(
    () => (status === "confirmed" ? ("confirmed" as const) : ("none" as const)),
    [status],
  );

  const isReadOnly = status === "confirmed" || status === "dispatched";

  async function handleConfirm() {
    const validation = validateDispatch({ conflicts, usedLdm });
    if (!validation.ok) {
      showToast({ type: "error", message: validation.message ?? "Nie można wysłać planu." });
      return;
    }
    const confirmed = await updateSessionStatusMock(SESSION_ID, "confirmed");
    setStatus(confirmed?.status ?? "confirmed");
    showToast({ type: "success", message: "Trasa zatwierdzona." });
  }

  return (
    <>
      <VehicleHeader
        usedLdm={usedLdm}
        maxLdm={20}
        sessionStatus={status}
        routeMode={routeMode}
        onConfirm={isReadOnly ? undefined : () => void handleConfirm()}
      />
      <ToastViewport />
    </>
  );
}

function renderHarness(props: { conflicts: SlotConflict[]; usedLdm: number }) {
  return render(
    <ToastProvider>
      <DispatchHarness {...props} />
    </ToastProvider>,
  );
}

function makeConflict(): SlotConflict {
  return {
    type: "stacking_violation",
    affectedSlotIds: ["r0_c0", "r1_c0"],
    message: "Nieprawidłowe ułożenie palet.",
  };
}

beforeEach(() => {
  updateSessionStatusMock.mockReset();
  updateSessionStatusMock.mockResolvedValue({ id: SESSION_ID, status: "confirmed" });
});

afterEach(() => {
  vi.clearAllTimers();
});

describe("VehicleHeader — przycisk wysyłki do kierowcy", () => {
  it("blokuje wysyłkę i pokazuje Toast gdy naczepa jest pusta (usedLdm = 0)", async () => {
    renderHarness({ conflicts: [], usedLdm: 0 });

    const button = screen.getByRole("button", { name: /zatwierdź trasę/i });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(await screen.findByText("Nie można wysłać: Pusta naczepa")).toBeInTheDocument();
    expect(updateSessionStatusMock).not.toHaveBeenCalled();
  });

  it("blokuje wysyłkę i pokazuje Toast gdy występują konflikty ułożenia", async () => {
    renderHarness({ conflicts: [makeConflict()], usedLdm: 5 });

    const button = screen.getByRole("button", { name: /zatwierdź trasę/i });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(
      await screen.findByText("Nie można wysłać: Rozwiąż konflikty załadunku"),
    ).toBeInTheDocument();
    expect(updateSessionStatusMock).not.toHaveBeenCalled();
  });

  it("wysyła PATCH status=confirmed i przechodzi w tryb read-only dla poprawnego planu", async () => {
    renderHarness({ conflicts: [], usedLdm: 6.4 });

    const button = screen.getByRole("button", { name: /zatwierdź trasę/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(updateSessionStatusMock).toHaveBeenCalledWith(SESSION_ID, "confirmed");
    });

    // Tryb read-only: przycisk staje się nieaktywny i pokazuje status zatwierdzenia
    // bez przeładowania strony.
    const confirmedButton = await screen.findByRole("button", {
      name: /trasa zatwierdzona/i,
    });
    expect(confirmedButton).toBeDisabled();
  });
});
