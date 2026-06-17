"use client";

/**
 * MarketHeatMap — mapa giełdy (Leaflet + CartoDB Positron).
 *
 * Wizualizuje gęstość ofert na podstawie klastrów docelowych:
 *  - Klastry dostawy (deliveryClusters): główna warstwa gęstości.
 *  - Klastry załadunku (pickupClusters): dodatkowa warstwa, intensywność × 0.6.
 *  - Wybrany pickup + delivery zaznaczone pinem i połączone linią.
 *  - Legenda: gradient od niskiej do wysokiej gęstości.
 */

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo } from "react";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  useMap,
} from "react-leaflet";

import type { HeatCluster } from "@/lib/market/aggregateDestinations";
import type { MarketOffer } from "@/lib/api/marketClient";

const TILE_URL =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

/** Blue→accent colour scale: cold = low density, warm = high density. */
export function heatColor(intensity: number): string {
  const r = Math.round(26 + (1 - intensity) * 140);
  const g = Math.round(56 + (1 - intensity) * 130);
  const b = Math.round(245 - (1 - intensity) * 30);
  return `rgb(${r},${g},${b})`;
}

/** Radius proportional to sqrt(count), clamped 8–30px. */
function clusterRadius(count: number): number {
  const r = Math.sqrt(count) * 5;
  return Math.min(30, Math.max(8, r));
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 0) {
      map.fitBounds(points, { padding: [40, 40], maxZoom: 7 });
    }
  }, [map, points]);
  return null;
}

/** Map legend rendered as an absolutely positioned card inside the Leaflet container. */
function HeatLegend() {
  const STEPS = 5;
  const steps = Array.from({ length: STEPS }, (_, i) => i / (STEPS - 1));

  return (
    <div
      style={{
        position: "absolute",
        bottom: 24,
        right: 12,
        zIndex: 1000,
        background: "rgba(255,255,255,0.92)",
        borderRadius: 8,
        padding: "8px 12px",
        boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
        pointerEvents: "none",
      }}
    >
      <p
        style={{
          fontSize: 10,
          fontWeight: 600,
          marginBottom: 4,
          color: "#374151",
        }}
      >
        Ładunki / cel
      </p>
      <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
        <span style={{ fontSize: 9, color: "#6b7280" }}>niskie</span>
        {steps.map((t) => (
          <div
            key={t}
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: heatColor(t),
              opacity: 0.7,
            }}
          />
        ))}
        <span style={{ fontSize: 9, color: "#6b7280" }}>wysokie</span>
      </div>
    </div>
  );
}

export interface MarketHeatMapProps {
  deliveryClusters: HeatCluster[];
  pickupClusters: HeatCluster[];
  selectedOffer: MarketOffer | null;
  onClusterClick?: (offerId: string | undefined) => void;
}

export default function MarketHeatMap({
  deliveryClusters,
  pickupClusters,
  selectedOffer,
  onClusterClick,
}: MarketHeatMapProps) {
  const allClusters = useMemo(
    () => [...deliveryClusters, ...pickupClusters],
    [deliveryClusters, pickupClusters],
  );

  const center = useMemo<[number, number]>(() => {
    if (allClusters.length === 0) return [54.0, 15.0]; // centrum Europy
    const avgLat =
      allClusters.reduce((sum, p) => sum + p.lat, 0) / allClusters.length;
    const avgLon =
      allClusters.reduce((sum, p) => sum + p.lon, 0) / allClusters.length;
    return [avgLat, avgLon];
  }, [allClusters]);

  const boundingPoints = useMemo<[number, number][]>(
    () => allClusters.map((p) => [p.lat, p.lon]),
    [allClusters],
  );

  const selectedLine = useMemo<
    [[number, number], [number, number]] | null
  >(() => {
    if (!selectedOffer) return null;
    return [
      [selectedOffer.pickup.lat, selectedOffer.pickup.lon],
      [selectedOffer.delivery.lat, selectedOffer.delivery.lon],
    ];
  }, [selectedOffer]);

  return (
    <MapContainer
      center={center}
      zoom={4}
      className="route-map-leaflet"
      style={{ width: "100%", height: "100%", minHeight: 460, position: "relative" }}
      scrollWheelZoom
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />

      {boundingPoints.length > 1 && <FitBounds points={boundingPoints} />}

      {/* Delivery clusters (primary) */}
      {deliveryClusters.map((cluster, index) => (
        <CircleMarker
          key={`d-${index}`}
          center={[cluster.lat, cluster.lon]}
          radius={clusterRadius(cluster.count)}
          pathOptions={{
            color: "transparent",
            fillColor: heatColor(cluster.intensity),
            fillOpacity: 0.45 + cluster.intensity * 0.35,
          }}
          eventHandlers={{
            click: () => onClusterClick?.(cluster.offerId),
          }}
        />
      ))}

      {/* Pickup clusters (secondary) */}
      {pickupClusters.map((cluster, index) => (
        <CircleMarker
          key={`p-${index}`}
          center={[cluster.lat, cluster.lon]}
          radius={clusterRadius(cluster.count) * 0.7}
          pathOptions={{
            color: "transparent",
            fillColor: heatColor(cluster.intensity / 0.6), // normalise back before colour
            fillOpacity: 0.2 + cluster.intensity * 0.25,
          }}
          eventHandlers={{
            click: () => onClusterClick?.(cluster.offerId),
          }}
        />
      ))}

      {/* Selected offer — pickup pin */}
      {selectedOffer && (
        <CircleMarker
          center={[selectedOffer.pickup.lat, selectedOffer.pickup.lon]}
          radius={10}
          pathOptions={{
            color: "#1a38f5",
            weight: 2,
            fillColor: "#1a38f5",
            fillOpacity: 0.9,
          }}
        />
      )}

      {/* Selected offer — delivery pin */}
      {selectedOffer && (
        <CircleMarker
          center={[selectedOffer.delivery.lat, selectedOffer.delivery.lon]}
          radius={10}
          pathOptions={{
            color: "#dc2f2f",
            weight: 2,
            fillColor: "#dc2f2f",
            fillOpacity: 0.9,
          }}
        />
      )}

      {/* Route line for selected offer */}
      {selectedLine && (
        <Polyline
          positions={selectedLine}
          pathOptions={{
            color: "#1a38f5",
            weight: 2,
            dashArray: "6 5",
            opacity: 0.75,
          }}
        />
      )}

      <HeatLegend />
    </MapContainer>
  );
}
