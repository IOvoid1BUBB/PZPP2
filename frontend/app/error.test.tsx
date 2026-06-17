/**
 * error.test.tsx
 *
 * UX-05: the route-level error boundary renders a readable fallback and the
 * "Spróbuj ponownie" action calls Next.js `reset()` to re-render the segment.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RootError from "./error";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("RootError (route error boundary)", () => {
  it("renderuje fallback UI z komunikatem i id błędu", () => {
    const error = Object.assign(new Error("Boom"), { digest: "digest-123" });

    render(<RootError error={error} reset={() => {}} />);

    expect(
      screen.getByRole("heading", { name: "Coś poszło nie tak" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/ID błędu: digest-123/)).toBeInTheDocument();
  });

  it("przycisk „Spróbuj ponownie” wywołuje reset()", () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("Boom"), {});

    render(<RootError error={error} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: /Spróbuj ponownie/ }));

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
