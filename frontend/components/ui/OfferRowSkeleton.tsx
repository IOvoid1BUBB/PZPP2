/**
 * @file OfferRowSkeleton.tsx
 * Pulsing placeholder shown while the offer library loads (FEAT-07).
 * Matches the 88px row height of OfferRow to avoid layout shift.
 */
export function OfferRowSkeleton() {
  return (
    <div
      data-testid="offer-row-skeleton"
      aria-hidden="true"
      className="flex h-[88px] animate-pulse flex-col gap-2 rounded-xl bg-ui-surface/60 p-3"
    >
      <div className="flex items-center justify-between">
        <div className="h-2.5 w-24 rounded bg-ui-raised" />
        <div className="h-4 w-16 rounded-full bg-ui-raised" />
      </div>
      <div className="h-3 w-3/4 rounded bg-ui-raised" />
      <div className="mt-auto flex gap-2">
        <div className="h-2.5 w-12 rounded bg-ui-raised" />
        <div className="h-2.5 w-12 rounded bg-ui-raised" />
        <div className="h-2.5 w-12 rounded bg-ui-raised" />
      </div>
    </div>
  );
}

export function OfferLibrarySkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Wczytywanie ofert">
      {Array.from({ length: count }).map((_, i) => (
        <OfferRowSkeleton key={i} />
      ))}
    </div>
  );
}
