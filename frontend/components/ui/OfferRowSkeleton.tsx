/**
 * @file OfferRowSkeleton.tsx
 * Pulsing placeholder shown while the offer library loads (FEAT-07).
 * Mirrors the layout of `.offer-card--library` (88px row: score bar, route, meta)
 * so swapping the skeleton for real cards causes no layout shift.
 */
export function OfferRowSkeleton() {
  return (
    <div
      data-testid="offer-row-skeleton"
      aria-hidden="true"
      className="mb-2 flex h-[88px] animate-pulse flex-col gap-2 rounded-lg border border-ui-border/60 bg-ui-raised px-4 py-3.5"
    >
      {/* Score-row placeholder: score bar + total score, plus a badge pill. */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-1 items-center gap-2">
          <div className="h-2 flex-1 rounded-full bg-ui-border" />
          <div className="h-3 w-7 rounded bg-ui-border" />
        </div>
        <div className="h-4 w-16 rounded-full bg-ui-border" />
      </div>

      {/* Route placeholder. */}
      <div className="h-3 w-2/3 rounded bg-ui-border" />

      {/* Meta placeholder (2-column grid like .offer-card__meta--compact). */}
      <div className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1">
        <div className="h-2 w-20 rounded bg-ui-border" />
        <div className="h-2 w-14 rounded bg-ui-border" />
      </div>
    </div>
  );
}

export function OfferLibrarySkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="flex flex-col gap-0"
      role="status"
      aria-busy="true"
      aria-label="Wczytywanie ofert"
    >
      {Array.from({ length: count }).map((_, i) => (
        <OfferRowSkeleton key={i} />
      ))}
    </div>
  );
}
