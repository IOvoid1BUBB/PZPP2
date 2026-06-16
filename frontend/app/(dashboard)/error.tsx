"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard segment error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 rounded-2xl border border-ui-border/60 bg-ui-surface px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-ui-error/10 text-ui-error">
        <AlertTriangle className="size-6" aria-hidden="true" />
      </span>
      <h2 className="text-lg font-semibold text-ui-primary">
        Nie udało się wyświetlić tej sekcji
      </h2>
      <p className="max-w-md text-sm text-ui-secondary">
        Wystąpił błąd podczas ładowania widoku. Reszta aplikacji działa
        normalnie — spróbuj ponownie.
      </p>
      <button
        type="button"
        onClick={reset}
        className="inline-flex items-center gap-2 rounded-full bg-ui-black px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        <RotateCcw className="size-4" aria-hidden="true" />
        Spróbuj ponownie
      </button>
    </div>
  );
}
