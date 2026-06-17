"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to console (and, in production, an external logging service).
    console.error("Unhandled application error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-ui-error/10 text-ui-error">
        <AlertTriangle className="size-7" aria-hidden="true" />
      </span>
      <h1 className="text-xl font-semibold text-ui-primary">Coś poszło nie tak</h1>
      <p className="max-w-md text-sm text-ui-secondary">
        Wystąpił nieoczekiwany błąd. Możesz spróbować ponownie — jeśli problem
        się powtarza, odśwież stronę lub wróć później.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-ui-muted">ID błędu: {error.digest}</p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-ui-black px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        <RotateCcw className="size-4" aria-hidden="true" />
        Spróbuj ponownie
      </button>
    </div>
  );
}
