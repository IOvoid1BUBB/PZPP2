import type { ProfitBreakdownData } from "@/lib/api/profitClient";
import { getClientColorHex } from "@/components/planner/TrailerCanvas";
import type { PalletData } from "@/lib/types/load";

import { formatEur } from "./buildWaterfallData";

export const ESTIMATED_RATE_PER_LDM = 187.5;

export type ClientPieValueSource = "revenue" | "estimated";

export interface ClientSummaryInput {
  clientId: string;
  offerId: string;
  name: string;
  ldm: number;
}

export interface ClientPieSlice {
  clientId: string;
  offerId: string;
  name: string;
  value: number;
  ldm: number;
  valueSource: ClientPieValueSource;
  fill: string;
}

export function formatLdm(value: number): string {
  return `${value.toLocaleString("pl-PL", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} LDM`;
}

export function formatPieTooltipValue(slice: ClientPieSlice): string {
  if (slice.valueSource === "revenue") {
    return formatEur(slice.value);
  }

  return `${formatLdm(slice.ldm)} · ${formatEur(slice.value)} (szac.)`;
}

function sumClientRevenue(
  clientId: string,
  slots: Record<string, PalletData | null>,
  revenueByOffer: Map<string, number>,
): number {
  let total = 0;

  for (const pallet of Object.values(slots)) {
    if (!pallet || pallet.clientId !== clientId) {
      continue;
    }
    total += revenueByOffer.get(pallet.offerId) ?? 0;
  }

  return total;
}

export function shouldUseApiRevenue(data: ProfitBreakdownData | undefined): boolean {
  return Boolean(data?.fromApi && (data.offerRevenue?.length ?? 0) > 0);
}

/**
 * Maps session client summary → pie slices (revenue from API or LDM × rate).
 * Segment colors use {@link getClientColorHex} — same index as TrailerCanvas.
 */
export function buildClientPieData(
  clientSummary: ClientSummaryInput[],
  slots: Record<string, PalletData | null>,
  data: ProfitBreakdownData | undefined,
  isDark = false,
): ClientPieSlice[] {
  if (clientSummary.length === 0) {
    return [];
  }

  const revenueByOffer = new Map(
    (data?.offerRevenue ?? []).map((row) => [row.offerId, row.revenueEur]),
  );
  const useApiRevenue = shouldUseApiRevenue(data);

  return clientSummary.map((client) => {
    const value = useApiRevenue
      ? sumClientRevenue(client.clientId, slots, revenueByOffer)
      : Math.round(client.ldm * ESTIMATED_RATE_PER_LDM);

    return {
      clientId: client.clientId,
      offerId: client.offerId,
      name: client.name,
      value,
      ldm: client.ldm,
      valueSource: useApiRevenue ? "revenue" : "estimated",
      fill: getClientColorHex(client.offerId, isDark),
    };
  });
}
