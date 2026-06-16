/**
 * @file aggregateDestinations.ts
 * Groups delivery (and pickup) points into 0.5° × 0.5° grid cells.
 * Returns HeatCluster[] for the MarketHeatMap component.
 */

import type { MarketOffer } from "@/lib/api/marketClient";

/** A clustered heat point for the destination-density heatmap. */
export interface HeatCluster {
  lat: number;
  lon: number;
  /** Normalised intensity 0..1 (count / maxCount). */
  intensity: number;
  /** Number of offers in this cell. */
  count: number;
  /** Set only for single-offer cells (enables click-select). */
  offerId?: string;
}

const GRID_STEP = 0.5;

function bucket(val: number): number {
  return Math.round(val / GRID_STEP) * GRID_STEP;
}

function bucketKey(lat: number, lon: number): string {
  return `${bucket(lat).toFixed(1)}_${bucket(lon).toFixed(1)}`;
}

interface Cell {
  latSum: number;
  lonSum: number;
  count: number;
  offerIds: string[];
}

function buildClusters(
  points: { lat: number; lon: number; offerId: string }[],
): HeatCluster[] {
  const cells = new Map<string, Cell>();

  for (const pt of points) {
    const key = bucketKey(pt.lat, pt.lon);
    const cell = cells.get(key);
    if (cell) {
      cell.latSum += pt.lat;
      cell.lonSum += pt.lon;
      cell.count += 1;
      cell.offerIds.push(pt.offerId);
    } else {
      cells.set(key, {
        latSum: pt.lat,
        lonSum: pt.lon,
        count: 1,
        offerIds: [pt.offerId],
      });
    }
  }

  const maxCount = Math.max(...Array.from(cells.values()).map((c) => c.count), 1);

  return Array.from(cells.values()).map((cell) => ({
    lat: cell.latSum / cell.count,
    lon: cell.lonSum / cell.count,
    intensity: cell.count / maxCount,
    count: cell.count,
    offerId: cell.offerIds.length === 1 ? cell.offerIds[0] : undefined,
  }));
}

export interface AggregatedDestinations {
  deliveryClusters: HeatCluster[];
  pickupClusters: HeatCluster[];
}

/**
 * Aggregate delivery and pickup points from all offers into density clusters.
 * Delivery clusters are primary (intensity as-is).
 * Pickup clusters are secondary (intensity *= 0.6).
 */
export function aggregateDestinations(offers: MarketOffer[]): AggregatedDestinations {
  const deliveryPoints = offers.map((o) => ({
    lat: o.delivery.lat,
    lon: o.delivery.lon,
    offerId: o.id,
  }));

  const pickupPoints = offers.map((o) => ({
    lat: o.pickup.lat,
    lon: o.pickup.lon,
    offerId: o.id,
  }));

  const deliveryClusters = buildClusters(deliveryPoints);
  const pickupClusters = buildClusters(pickupPoints).map((c) => ({
    ...c,
    intensity: c.intensity * 0.6,
  }));

  return { deliveryClusters, pickupClusters };
}
