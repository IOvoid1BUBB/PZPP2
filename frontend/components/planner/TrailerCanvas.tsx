"use client";

import {
  useCallback,
  useMemo,
  useRef,
  type FC,
  type RefObject,
  type SVGProps,
} from "react";

import { DraggablePallet } from "@/components/planner/DraggablePallet";
import { DroppableSlot } from "@/components/planner/DroppableSlot";
import { useClientSummary } from "@/lib/stores/loadStore";
import type { PalletData, PayloadSlotConfig, VehicleConfig } from "@/lib/types/load";

const SCALE = 0.4;
const SLOT_WIDTH_PX = 80 * SCALE;
const SLOT_HEIGHT_PX = 120 * SCALE;
const TRAILER_PADDING = 8;

const CLIENT_COLORS = [
  "#4E9AF1",
  "#E8564A",
  "#45C97A",
  "#F5A623",
  "#9B59B6",
  "#1ABC9C",
  "#E67E22",
  "#3498DB",
  "#E91E63",
  "#00BCD4",
  "#8BC34A",
  "#FF5722",
] as const;

interface TrailerCanvasProps {
  vehicle: VehicleConfig;
  slots: Record<string, PalletData | null>;
  conflictSlotIds: Set<string>;
  shakingSlotIds: Set<string>;
  activeSlotId: string | null;
  bindSlotMenu: (slotId: string) => Record<string, unknown>;
}

interface OutlineProps {
  width: number;
  height: number;
}

/** Placeholder — replace with real Master top-view SVG asset later. */
function MasterOutlinePlaceholder({ width, height }: OutlineProps) {
  const cabH = height * 0.22;
  const bedY = cabH;
  const w = width;
  const path = [
    `M ${w * 0.12} ${bedY}`,
    `L ${w * 0.12} ${cabH * 0.35}`,
    `Q ${w * 0.5} 0 ${w * 0.88} ${cabH * 0.35}`,
    `L ${w * 0.88} ${bedY}`,
    `L ${w * 0.88} ${height - 4}`,
    `L ${w * 0.12} ${height - 4}`,
    "Z",
  ].join(" ");

  return (
    <path
      d={path}
      fill="none"
      stroke="var(--color-border-strong)"
      strokeWidth={1.5}
      vectorEffect="non-scaling-stroke"
    />
  );
}

/** Placeholder — replace with real MAN truck top-view SVG asset later. */
function ManOutlinePlaceholder({ width, height }: OutlineProps) {
  const cabH = height * 0.12;
  const bedY = cabH;
  const w = width;
  const path = [
    `M ${w * 0.08} ${bedY}`,
    `L ${w * 0.08} ${cabH * 0.4}`,
    `Q ${w * 0.5} 2 ${w * 0.92} ${cabH * 0.4}`,
    `L ${w * 0.92} ${bedY}`,
    `L ${w * 0.92} ${height - 4}`,
    `L ${w * 0.08} ${height - 4}`,
    "Z",
  ].join(" ");

  return (
    <path
      d={path}
      fill="none"
      stroke="var(--color-border-strong)"
      strokeWidth={1.5}
      vectorEffect="non-scaling-stroke"
    />
  );
}

const VEHICLE_OUTLINES: Record<VehicleConfig["type"], FC<OutlineProps>> = {
  master_l2: MasterOutlinePlaceholder,
  master_l3: MasterOutlinePlaceholder,
  master_l4: MasterOutlinePlaceholder,
  man_solo: ManOutlinePlaceholder,
};

export function getClientColor(offerId: string): string {
  const hash = offerId
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return CLIENT_COLORS[hash % CLIENT_COLORS.length];
}

function truncateLabel(name: string, max = 6): string {
  if (name.length <= max) {
    return name;
  }
  return `${name.slice(0, max)}…`;
}

const DEFAULT_SLOT_WIDTH_CM = 80;
const DEFAULT_SLOT_DEPTH_CM = 120;

function slotFootprintPx(config: PayloadSlotConfig): { width: number; height: number } {
  const widthCm = config.widthCm ?? DEFAULT_SLOT_WIDTH_CM;
  const depthCm = config.depthCm ?? DEFAULT_SLOT_DEPTH_CM;
  return {
    width: widthCm * SCALE,
    height: depthCm * SCALE,
  };
}

function slotPosition(config: { xOffsetCm: number; yOffsetCm: number }) {
  return {
    x: TRAILER_PADDING + config.xOffsetCm * SCALE,
    y: TRAILER_PADDING + config.yOffsetCm * SCALE,
  };
}

export function exportToPng(svgRef: RefObject<SVGSVGElement | null>): void {
  const svg = svgRef.current;
  if (!svg) {
    return;
  }

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svg);
  const svgBlob = new Blob([svgString], {
    type: "image/svg+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(svgBlob);

  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = svg.viewBox.baseVal.width || svg.clientWidth;
    canvas.height = svg.viewBox.baseVal.height || svg.clientHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      URL.revokeObjectURL(url);
      return;
    }
    ctx.drawImage(image, 0, 0);
    URL.revokeObjectURL(url);

    const pngUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = pngUrl;
    link.download = "plan-zaladunku.png";
    link.click();
  };
  image.src = url;
}

interface SlotSvgRectProps extends SVGProps<SVGRectElement> {
  slotId: string;
  title: string;
}

function SlotSvgRect({ slotId, title, ...rectProps }: SlotSvgRectProps) {
  return (
    <g data-slot-id={slotId}>
      <title>{title}</title>
      <rect {...rectProps} />
    </g>
  );
}

export function TrailerCanvas({
  vehicle,
  slots,
  conflictSlotIds,
  shakingSlotIds,
  activeSlotId,
  bindSlotMenu,
}: TrailerCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const clientSummary = useClientSummary();

  const bedWidthPx = vehicle.trailerWidthCm * SCALE + 2 * TRAILER_PADDING;
  const bedHeightPx = vehicle.trailerLengthCm * SCALE + 2 * TRAILER_PADDING;
  const Outline = VEHICLE_OUTLINES[vehicle.type];

  const slotTitles = useMemo(() => {
    const titles: Record<string, string> = {};
    for (const [slotId, config] of Object.entries(vehicle.payloadSlots)) {
      const pallet = slots[slotId] ?? null;
      if (pallet) {
        titles[slotId] =
          `Slot ${slotId}: ${pallet.clientName}, ${pallet.ldm.toFixed(1)} LDM, ${pallet.weightKg} kg`;
      } else {
        titles[slotId] = `Slot ${slotId}: pusty`;
      }
    }
    return titles;
  }, [vehicle.payloadSlots, slots]);

  const handleExportPng = useCallback(() => {
    exportToPng(svgRef);
  }, []);

  return (
    <div className="trailer-canvas-root">
      <div
        className="trailer-svg-wrap"
        style={{ width: bedWidthPx, maxWidth: "100%" }}
      >
        <svg
          ref={svgRef}
          className="trailer-canvas__svg"
          viewBox={`0 0 ${bedWidthPx} ${bedHeightPx}`}
          width={bedWidthPx}
          height={bedHeightPx}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Plan załadunku ${vehicle.name}`}
        >
          <g className="trailer-outline">
            <Outline width={bedWidthPx} height={bedHeightPx} />
          </g>

          <rect
            x={TRAILER_PADDING}
            y={TRAILER_PADDING}
            width={vehicle.trailerWidthCm * SCALE}
            height={vehicle.trailerLengthCm * SCALE}
            fill="var(--color-trailer-bed)"
            opacity={0.1}
            rx={2}
          />

          <g className="trailer-slots">
            {Object.entries(vehicle.payloadSlots).map(([slotId, config]) => {
              const { x, y } = slotPosition(config);
              const pallet = slots[slotId] ?? null;
              const isConflict = conflictSlotIds.has(slotId);
              const title = slotTitles[slotId] ?? `Slot ${slotId}`;

              const footprint = slotFootprintPx(config);

              if (!pallet) {
                return (
                  <SlotSvgRect
                    key={slotId}
                    slotId={slotId}
                    title={title}
                    x={x}
                    y={y}
                    width={footprint.width}
                    height={footprint.height}
                    fill="var(--color-surface-raised)"
                    stroke="var(--color-border)"
                    strokeWidth={1}
                    strokeDasharray="4 2"
                    rx={2}
                  />
                );
              }

              const { width: rectW, height: rectH } = footprint;
              const fill = getClientColor(pallet.offerId);
              const conflictClass = isConflict
                ? "trailer-slot--conflict-pulse"
                : undefined;

              return (
                <g key={slotId}>
                  <SlotSvgRect
                    slotId={slotId}
                    title={title}
                    x={x}
                    y={y}
                    width={rectW}
                    height={rectH}
                    fill={fill}
                    opacity={0.85}
                    stroke={
                      isConflict ? "var(--color-warning)" : "none"
                    }
                    strokeWidth={isConflict ? 2 : 0}
                    strokeDasharray={
                      !pallet.stackable ? "3 2" : undefined
                    }
                    rx={2}
                    className={conflictClass}
                  />
                  <text
                    x={x + rectW / 2}
                    y={y + rectH / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#fff"
                    fontSize={10}
                    fontWeight={600}
                    pointerEvents="none"
                  >
                    {truncateLabel(pallet.clientName)}
                  </text>
                  {!pallet.stackable ? (
                    <text
                      x={x + 2}
                      y={y + 8}
                      fill="var(--color-warning)"
                      fontSize={7}
                      fontWeight={600}
                      pointerEvents="none"
                    >
                      NONSTD
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>

        <div
          className="trailer-canvas trailer-dnd-overlay"
          style={{ width: bedWidthPx, height: bedHeightPx }}
        >
          {Object.entries(vehicle.payloadSlots).map(([slotId, config]) => {
            const { x, y } = slotPosition(config);
            const left = x;
            const top = y;
            const pallet = slots[slotId] ?? null;
            const isConflict = conflictSlotIds.has(slotId);
            const menuProps = bindSlotMenu(slotId);

            const footprint = slotFootprintPx(config);
            const hitW = footprint.width;
            const hitH = footprint.height;

            if (pallet) {
              return (
                <DraggablePallet
                  key={slotId}
                  slotId={slotId}
                  pallet={pallet}
                  left={left}
                  top={top}
                  width={hitW}
                  height={hitH}
                  isConflict={isConflict}
                  isShaking={shakingSlotIds.has(slotId)}
                  menuProps={menuProps}
                />
              );
            }

            return (
              <DroppableSlot
                key={slotId}
                slotId={slotId}
                left={left}
                top={top}
                width={hitW}
                height={hitH}
                isOver={activeSlotId === slotId}
                isConflict={isConflict}
                menuProps={menuProps}
              />
            );
          })}
        </div>
      </div>

      {clientSummary.length > 0 ? (
        <div className="trailer-legend">
          {clientSummary.map((client) => (
            <div key={client.offerId} className="trailer-legend__item">
              <span
                className="trailer-legend__swatch"
                style={{ backgroundColor: getClientColor(client.offerId) }}
              />
              <span>{client.name}</span>
              <span className="text-secondary">{client.ldm.toFixed(1)} LDM</span>
            </div>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        className="button button--secondary trailer-canvas__export"
        onClick={handleExportPng}
      >
        Eksportuj PNG
      </button>
    </div>
  );
}
