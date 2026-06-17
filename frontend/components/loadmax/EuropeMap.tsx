"use client";

import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import type { ReactNode } from "react";

const GEO_URL = "/geo/countries-50m.json";

interface GeographyShape {
  rsmKey: string;
}

type EuropeMapProps = {
  /** środek mapy [lng, lat] */
  center?: [number, number];
  scale?: number;
  children?: ReactNode;
  className?: string;
};

/**
 * Stylizowana mapa środkowej Europy oparta na react-simple-maps
 * (dokładna geometria krajów, bez zewnętrznego API kafelków).
 * Markery/linie przekazuje się jako children.
 */
export function EuropeMap({
  center = [14, 54],
  scale = 650,
  children,
  className,
}: EuropeMapProps) {
  return (
    <div
      className={className}
      style={{ background: "#c9cbe8", width: "100%", height: "100%" }}
    >
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ center, scale }}
        width={800}
        height={600}
        style={{ width: "100%", height: "100%" }}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }: { geographies: GeographyShape[] }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill="#e6e7ef"
                stroke="#b8bacb"
                strokeWidth={0.4}
                style={{
                  default: { outline: "none" },
                  hover: { outline: "none", fill: "#dcdded" },
                  pressed: { outline: "none" },
                }}
              />
            ))
          }
        </Geographies>
        {children}
      </ComposableMap>
    </div>
  );
}
