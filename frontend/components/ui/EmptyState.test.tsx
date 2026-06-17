/**
 * EmptyState.test.tsx
 *
 * Współdzielony panel pustego stanu (UX-03). Testy pokrywają render tytułu,
 * opisu, CTA, ikony oraz dokładne komunikaty PL dla 4 kontekstów Epic 9.3.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Truck } from "lucide-react";

import { EmptyState } from "./EmptyState";

describe("EmptyState (UX-03)", () => {
  it("renderuje tytuł, opis i role=status", () => {
    render(<EmptyState title="Tytuł panelu" description="Opis kontekstu" />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Tytuł panelu" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Opis kontekstu")).toBeInTheDocument();
  });

  it("renderuje CTA (action) gdy podane", () => {
    render(
      <EmptyState
        title="Pusty panel"
        action={<button type="button">Zrób coś</button>}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Zrób coś" }),
    ).toBeInTheDocument();
  });

  it("przyjmuje niestandardowy data-testid oraz ikonę", () => {
    render(<EmptyState title="x" icon={Truck} data-testid="custom-empty" />);

    expect(screen.getByTestId("custom-empty")).toBeInTheDocument();
  });

  it("pomija akapit opisu gdy nie podano description", () => {
    const { container } = render(<EmptyState title="Tylko tytuł" />);

    expect(
      screen.getByRole("heading", { name: "Tylko tytuł" }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  // Każdy z 4 kontekstów Epic 9.3 ma dedykowany, dokładny komunikat PL.
  it.each([
    ["no_session", "Wybierz pojazd, aby rozpocząć planowanie"],
    ["no_offers", "Brak ofert spełniających kryteria. Zmień filtry."],
    ["map", "Dodaj oferty, aby zobaczyć trasę"],
    ["dashboard", "Brak aktywnych tras dziś"],
  ])("renderuje dokładny komunikat PL kontekstu %s", (_context, message) => {
    render(<EmptyState title={message} data-testid="empty-state" />);

    expect(screen.getByRole("heading", { name: message })).toBeInTheDocument();
  });
});
