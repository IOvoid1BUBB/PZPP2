"use client";

/**
 * MarketHeatMap — mapa giełdy (Leaflet + CartoDB Positron).
 *
 * Wizualizuje gęstość ofert wg score/EUR/LDM:
 *  - Wszystkie punkty pickup/delivery renderowane jako półprzezroczyste kółka
 *    o promieniu i kolorze proporcjonalnym do intensywności (score).
 *  - Wybrany pickup + delivery zaznaczone pinem i połączone linią.
 *  - Motyw kafelków: CartoDB Positron — szaro-biały, pasuje do --ui-bg #f3f4f7.
 */

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";

import type { HeatPoint } from "@/app/(dashboard)/market/page";
import type { MarketOffer } from "@/lib/api/marketClient";

// CartoDB Positron — jasny motyw kompatybilny z paletą UI
const TILE_URL =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

// Kolory heatmapy: niebieski (niska intensywność) → fioletowy → accent (wysoka)
function heatColor(intensity: number): string {
  // 0 = zimny szaro-niebieski, 1 = --ui-accent #1a38f5 z odrobiną nasycenia
  const r = Math.round(26 + (1 - intensity) * 140);   // 166 → 26
  const g = Math.round(56 + (1 - intensity) * 130);   // 186 → 56
  const b = Math.round(245 - (1 - intensity) * 30);   // 215 → 245
  return `rgb(${r},${g},${b})`;
}

function heatRadius(intensity: number): number {
  return 6 + intensity * 14; // 6px (słaba) → 20px (mocna)
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 0) {
      map.fitBounds(points, { padding: [40, 40], maxZoom: 8 });
    }
  }, [map, points]);
  return null;
}

export interface MarketHeatMapProps {
  heatPoints: HeatPoint[];
  selectedOffer: MarketOffer | null;
  onMarkerClick?: (offerId: string) => void;
}

export default function MarketHeatMap({
  heatPoints,
  selectedOffer,
  onMarkerClick,
}: MarketHeatMapProps) {
  // Środek mapy: centroid wszystkich punktów lub środkowa Europa
  const center = useMemo<[number, number]>(() => {
    if (heatPoints.length === 0) return [51.5, 19.0];
    const avgLat =
      heatPoints.reduce((sum, p) => sum + p.lat, 0) / heatPoints.length;
    const avgLon =
      heatPoints.reduce((sum, p) => sum + p.lon, 0) / heatPoints.length;
    return [avgLat, avgLon];
  }, [heatPoints]);

  // Bounding box dla fitBounds
  const boundingPoints = useMemo<[number, number][]>(
    () => heatPoints.map((p) => [p.lat, p.lon]),
    [heatPoints],
  );

  // Wybrany pickup + delivery do pina i linii
  const selectedLine = useMemo<[[number, number], [number, number]] | null>(() => {
    if (!selectedOffer) return null;
    return [
      [selectedOffer.pickup.lat, selectedOffer.pickup.lon],
      [selectedOffer.delivery.lat, selectedOffer.delivery.lon],
    ];
  }, [selectedOffer]);

  return (
    <MapContainer
      center={center}
      zoom={5}
      className="route-map-leaflet"
      style={{ width: "100%", height: "100%", minHeight: 460 }}
      scrollWheelZoom
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />

      {boundingPoints.length > 1 && <FitBounds points={boundingPoints} />}

      {/* Wszystkie punkty heatmapy */}
      {heatPoints.map((point, index) => (
        <CircleMarker
          key={`${point.offerId}-${index}`}
          center={[point.lat, point.lon]}
          radius={heatRadius(point.intensity)}
          pathOptions={{
            color: "transparent",
            fillColor: heatColor(point.intensity),
            fillOpacity: 0.35 + point.intensity * 0.35,
          }}
          eventHandlers={{
            click: () => onMarkerClick?.(point.offerId),
          }}
        />
      ))}

      {/* Wybrany pin pickup */}
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

      {/* Wybrany pin delivery */}
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

      {/* Linia trasy wybranej oferty */}
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
    </MapContainer>
  );
}
