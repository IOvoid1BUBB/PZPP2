/**
 * @file aggregateWeeklyEurLdm.ts
 * Agreguje oferty rynkowe wg tygodnia i dnia tygodnia, licząc średnią EUR/LDM.
 * Zasila wykres tygodniowy na stronie giełdy (Market hub).
 */

import type { MarketOffer } from "@/lib/api/marketClient";

export interface WeeklyBucket {
  label: string;
  /** Średnia EUR/LDM tygodnia (sformatowana, np. "2.31"). */
  avg: string;
  /** Średnia EUR/LDM tygodnia jako liczba (0 gdy brak danych). */
  avgValue: number;
  /** 7 średnich EUR/LDM (poniedziałek → niedziela), 0 gdy brak danych. */
  bars: number[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_COUNT = 4;

/** Indeks dnia tygodnia 0..6 (poniedziałek..niedziela). */
function isoDayOfWeek(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

/**
 * @param offers   oferty z giełdy (eurPerLdm wyliczone w marketClient)
 * @param nowMs    punkt odniesienia (testowalność)
 * @returns        do 4 tygodni (od najstarszego do najnowszego)
 */
export function aggregateWeeklyEurLdm(
  offers: MarketOffer[],
  nowMs: number = Date.now(),
): WeeklyBucket[] {
  // sums[weekBucket][dow] oraz counts[weekBucket][dow]
  const sums: number[][] = Array.from({ length: WEEK_COUNT }, () =>
    Array.from({ length: 7 }, () => 0),
  );
  const counts: number[][] = Array.from({ length: WEEK_COUNT }, () =>
    Array.from({ length: 7 }, () => 0),
  );

  for (const offer of offers) {
    const stamp = offer.timeWindowOpen;
    if (!stamp || offer.eurPerLdm <= 0) {
      continue;
    }
    const time = new Date(stamp).getTime();
    if (!Number.isFinite(time)) {
      continue;
    }
    const weekBucket = Math.floor((nowMs - time) / (7 * DAY_MS));
    if (weekBucket < 0 || weekBucket >= WEEK_COUNT) {
      continue;
    }
    const dow = isoDayOfWeek(new Date(time));
    sums[weekBucket][dow] += offer.eurPerLdm;
    counts[weekBucket][dow] += 1;
  }

  const buckets: WeeklyBucket[] = [];
  // weekBucket 0 = bieżący tydzień; wyświetlamy od najstarszego (Week 1)
  for (let i = WEEK_COUNT - 1; i >= 0; i -= 1) {
    const bars = sums[i].map((sum, dow) =>
      counts[i][dow] > 0 ? Math.round((sum / counts[i][dow]) * 100) / 100 : 0,
    );
    const totalSum = sums[i].reduce((acc, value) => acc + value, 0);
    const totalCount = counts[i].reduce((acc, value) => acc + value, 0);
    const avg = totalCount > 0 ? totalSum / totalCount : 0;
    buckets.push({
      label: `Week ${WEEK_COUNT - i}`,
      avg: avg > 0 ? avg.toFixed(2) : "—",
      avgValue: avg > 0 ? Math.round(avg * 100) / 100 : 0,
      bars,
    });
  }

  return buckets;
}
