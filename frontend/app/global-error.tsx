"use client";

import { useEffect } from "react";

/**
 * Last-resort error boundary for failures in the root layout itself.
 * Must render its own <html>/<body> because it replaces the root layout.
 * Uses inline styles only (the app stylesheet may not be available here).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Fatal root layout error:", error);
  }, [error]);

  return (
    <html lang="pl">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          background: "#f4f5fb",
          color: "#1f2430",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
          Coś poszło nie tak
        </h1>
        <p style={{ maxWidth: 420, fontSize: "0.95rem", color: "#5b6172" }}>
          Aplikacja napotkała krytyczny błąd. Odśwież stronę, aby kontynuować.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            cursor: "pointer",
            border: "none",
            borderRadius: 999,
            background: "#1f2430",
            color: "#fff",
            padding: "0.65rem 1.4rem",
            fontSize: "0.9rem",
            fontWeight: 600,
          }}
        >
          Spróbuj ponownie
        </button>
      </body>
    </html>
  );
}
