"use client";

import { Marker, Line } from "react-simple-maps";

type Coord = [number, number];

const COLORS = {
  blue: "#1a38f5",
  red: "#dc2f2f",
  grey: "#9ca3af",
  amber: "#f59e0b",
} as const;

/** Zaokrąglony marker z numerem/etykietą (zgodny z pinami z Figmy). */
export function SquareMarker({
  coordinates,
  label,
  color = "blue",
  onClick,
}: {
  coordinates: Coord;
  label: string;
  color?: keyof typeof COLORS;
  onClick?: () => void;
}) {
  const w = label.length > 2 ? 34 : 26;
  return (
    <Marker coordinates={coordinates} onClick={onClick}>
      <g
        transform={`translate(${-w / 2}, ${-13})`}
        style={{ cursor: onClick ? "pointer" : "default" }}
      >
        <rect
          width={w}
          height={26}
          rx={7}
          fill={COLORS[color]}
          stroke="#ffffff"
          strokeWidth={1.5}
        />
        <text
          x={w / 2}
          y={17}
          textAnchor="middle"
          fontSize={12}
          fontWeight={700}
          fill="#ffffff"
        >
          {label}
        </text>
      </g>
    </Marker>
  );
}

/** Miękka poświata radialna używana na mapie giełdy. */
export function HeatGlow({
  coordinates,
  color = "#ef4444",
  radius = 26,
}: {
  coordinates: Coord;
  color?: string;
  radius?: number;
}) {
  const id = `glow-${coordinates.join("-")}`;
  return (
    <Marker coordinates={coordinates}>
      <defs>
        <radialGradient id={id}>
          <stop offset="0%" stopColor={color} stopOpacity={0.55} />
          <stop offset="50%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle r={radius} fill={`url(#${id})`} />
    </Marker>
  );
}

/** Linia trasy (przerywana) między dwoma punktami. */
export function RouteLine({
  from,
  to,
  color = "#1a38f5",
}: {
  from: Coord;
  to: Coord;
  color?: string;
}) {
  return (
    <Line
      from={from}
      to={to}
      stroke={color}
      strokeWidth={2}
      strokeDasharray="5 5"
      strokeLinecap="round"
    />
  );
}
