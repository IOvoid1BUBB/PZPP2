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

/** Cargo bed runs left → right; cab on the left. */
const SCALE = 0.88;
const TRAILER_PADDING = 10;
/** Equal inset on every slot so strokes do not merge — same proportion for all. */
const SLOT_STROKE_INSET_PX = 1;

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

const OCCUPIED_FILL_OPACITY = 0.55;

interface TrailerCanvasProps {
  vehicle: VehicleConfig;
  slots: Record<string, PalletData | null>;
  conflictSlotIds: Set<string>;
  shakingSlotIds: Set<string>;
  activeSlotId: string | null;
  bindSlotMenu: (slotId: string) => Record<string, unknown>;
}

interface BedLayout {
  cabX: number;
  bedX: number;
  bedY: number;
  bedW: number;
  bedH: number;
}

interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasLayout extends BedLayout {
  canvasW: number;
  canvasH: number;
}

function cabWidthPx(vehicleType: VehicleConfig["type"], bedHeightPx: number): number {
  const ratio = vehicleType === "man_solo" ? 0.34 : 0.42;
  return Math.round(bedHeightPx * ratio);
}

function buildCanvasLayout(vehicle: VehicleConfig): CanvasLayout {
  const bedW = vehicle.trailerLengthCm * SCALE;
  const bedH = vehicle.trailerWidthCm * SCALE;
  const cabW = cabWidthPx(vehicle.type, bedH);
  const cabX = TRAILER_PADDING;
  const bedX = TRAILER_PADDING + cabW;
  const bedY = TRAILER_PADDING;
  const canvasW = bedX + bedW + TRAILER_PADDING;
  const canvasH = bedY + bedH + TRAILER_PADDING;

  return { cabX, bedX, bedY, bedW, bedH, canvasW, canvasH };
}

/** Cab on the left; bed edges match the cargo grid origin. */
function MasterOutlineHorizontal({ cabX, bedX, bedY, bedW, bedH }: BedLayout) {
  const bedRight = bedX + bedW;
  const bedBottom = bedY + bedH;
  const midY = bedY + bedH / 2;
  const joinTop = bedY + bedH * 0.14;
  const joinBottom = bedY + bedH * 0.86;
  const hoodX = cabX + (bedX - cabX) * 0.58;

  const path = [
    `M ${bedX} ${bedY}`,
    `L ${bedRight - 3} ${bedY}`,
    `L ${bedRight - 3} ${bedBottom}`,
    `L ${bedX} ${bedBottom}`,
    `L ${bedX} ${joinBottom}`,
    `L ${hoodX} ${joinBottom}`,
    `Q ${cabX} ${midY} ${hoodX} ${joinTop}`,
    `L ${bedX} ${joinTop}`,
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

function ManOutlineHorizontal({ cabX, bedX, bedY, bedW, bedH }: BedLayout) {
  const bedRight = bedX + bedW;
  const bedBottom = bedY + bedH;
  const midY = bedY + bedH / 2;
  const joinTop = bedY + bedH * 0.12;
  const joinBottom = bedY + bedH * 0.86;
  const hoodX = cabX + (bedX - cabX) * 0.52;

  const path = [
    `M ${bedX} ${bedY}`,
    `L ${bedRight - 3} ${bedY}`,
    `L ${bedRight - 3} ${bedBottom}`,
    `L ${bedX} ${bedBottom}`,
    `L ${bedX} ${joinBottom}`,
    `L ${hoodX} ${joinBottom}`,
    `Q ${cabX} ${midY} ${hoodX} ${joinTop}`,
    `L ${bedX} ${joinTop}`,
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

const VEHICLE_OUTLINES: Record<VehicleConfig["type"], FC<BedLayout>> = {
  master_l2: MasterOutlineHorizontal,
  master_l3: MasterOutlineHorizontal,
  master_l4: MasterOutlineHorizontal,
  man_solo: ManOutlineHorizontal,
};

export function getClientColor(offerId: string): string {
  const hash = offerId
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return CLIENT_COLORS[hash % CLIENT_COLORS.length];
}

function truncateLabel(name: string, max = 8): string {
  if (name.length <= max) {
    return name;
  }
  return `${name.slice(0, max)}…`;
}

const DEFAULT_SLOT_WIDTH_CM = 80;
const DEFAULT_SLOT_DEPTH_CM = 120;

function safeNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

interface SlotBoundsCm {
  xOff: number;
  yOff: number;
  widthCm: number;
  depthCm: number;
}

/** Physical slot footprint — long 80×120 cm, trans 120×80 cm (matches EUR schematic). */
function slotBoundsFromConfig(config: PayloadSlotConfig): SlotBoundsCm {
  return {
    xOff: safeNumber(config.xOffsetCm, 0),
    yOff: safeNumber(config.yOffsetCm, 0),
    widthCm: safeNumber(config.widthCm, DEFAULT_SLOT_WIDTH_CM),
    depthCm: safeNumber(config.depthCm, DEFAULT_SLOT_DEPTH_CM),
  };
}

/** Map DB offsets (x = lateral, y = along bed) to horizontal canvas coordinates. */
function slotCanvasRect(
  layout: CanvasLayout,
  bounds: SlotBoundsCm,
  insetPx = SLOT_STROKE_INSET_PX,
): CanvasRect {
  const rawW = bounds.depthCm * SCALE;
  const rawH = bounds.widthCm * SCALE;
  const inset = Math.min(insetPx, rawW / 4, rawH / 4);

  return {
    x: layout.bedX + bounds.yOff * SCALE + inset,
    y: layout.bedY + bounds.xOff * SCALE + inset,
    width: rawW - inset * 2,
    height: rawH - inset * 2,
  };
}

function slotSortKey(config: PayloadSlotConfig): number {
  return config.yOffsetCm * 1000 + config.xOffsetCm;
}

function pct(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

function isValidSlotConfig(config: unknown): config is PayloadSlotConfig {
  if (!config || typeof config !== "object") return false;
  const cfg = config as Record<string, unknown>;
  const row = Number(cfg.row);
  const col = Number(cfg.col);
  const xOffsetCm = Number(cfg.xOffsetCm ?? cfg.x_offset_cm);
  const yOffsetCm = Number(cfg.yOffsetCm ?? cfg.y_offset_cm);
  return (
    Number.isFinite(row) &&
    Number.isFinite(col) &&
    Number.isFinite(xOffsetCm) &&
    Number.isFinite(yOffsetCm)
  );
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

  const layout = useMemo(() => buildCanvasLayout(vehicle), [vehicle]);
  const { canvasW, canvasH, bedX, bedY, bedW, bedH } = layout;
  const Outline = VEHICLE_OUTLINES[vehicle.type];

  const validSlotEntries = useMemo(
    () =>
      Object.entries(vehicle.payloadSlots)
        .filter(
          (entry): entry is [string, PayloadSlotConfig] => isValidSlotConfig(entry[1]),
        )
        .sort(([, a], [, b]) => slotSortKey(a) - slotSortKey(b)),
    [vehicle.payloadSlots],
  );

  const slotTitles = useMemo(() => {
    const titles: Record<string, string> = {};
    for (const [slotId] of validSlotEntries) {
      const pallet = slots[slotId] ?? null;
      if (pallet) {
        titles[slotId] =
          `Slot ${slotId}: ${pallet.clientName}, ${pallet.ldm.toFixed(1)} LDM, ${pallet.weightKg} kg`;
      } else {
        titles[slotId] = `Slot ${slotId}: pusty`;
      }
    }
    return titles;
  }, [validSlotEntries, slots]);

  const handleExportPng = useCallback(() => {
    exportToPng(svgRef);
  }, []);

  return (
    <div className="trailer-canvas-root">
      <div
        className="trailer-svg-wrap"
        style={{
          ["--trailer-canvas-width" as string]: `${canvasW}px`,
          ["--trailer-canvas-height" as string]: `${canvasH}px`,
        }}
      >
        <svg
          ref={svgRef}
          className="trailer-canvas__svg"
          viewBox={`0 0 ${canvasW} ${canvasH}`}
          width="100%"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Plan załadunku ${vehicle.name}`}
        >
          <g className="trailer-outline">
            <Outline {...layout} />
          </g>

          <rect
            x={bedX}
            y={bedY}
            width={bedW}
            height={bedH}
            fill="var(--color-trailer-bed)"
            opacity={0.1}
            rx={2}
          />

          <g className="trailer-slots">
            {validSlotEntries.map(([slotId, config]) => {
              const bounds = slotBoundsFromConfig(config);
              const rect = slotCanvasRect(layout, bounds);
              const pallet = slots[slotId] ?? null;
              const isConflict = conflictSlotIds.has(slotId);
              const title = slotTitles[slotId] ?? `Slot ${slotId}`;

              if (!pallet) {
                return (
                  <SlotSvgRect
                    key={slotId}
                    slotId={slotId}
                    title={title}
                    x={rect.x}
                    y={rect.y}
                    width={rect.width}
                    height={rect.height}
                    fill="var(--color-surface-raised)"
                    stroke="var(--color-border)"
                    strokeWidth={1}
                    strokeDasharray="4 2"
                    rx={3}
                  />
                );
              }

              const fill = pallet.clientColor || getClientColor(pallet.offerId);
              const conflictClass = isConflict
                ? "trailer-slot--conflict-pulse"
                : undefined;

              return (
                <g key={slotId}>
                  <SlotSvgRect
                    slotId={slotId}
                    title={title}
                    x={rect.x}
                    y={rect.y}
                    width={rect.width}
                    height={rect.height}
                    fill={fill}
                    fillOpacity={OCCUPIED_FILL_OPACITY}
                    stroke={isConflict ? "var(--color-warning)" : "var(--color-border-strong)"}
                    strokeWidth={isConflict ? 2 : 1}
                    strokeDasharray={!pallet.stackable ? "3 2" : undefined}
                    rx={3}
                    className={conflictClass}
                  />
                  <text
                    x={rect.x + rect.width / 2}
                    y={rect.y + rect.height / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="var(--color-text-primary)"
                    fontSize={Math.min(13, rect.width * 0.2, rect.height * 0.35)}
                    fontWeight={600}
                    pointerEvents="none"
                  >
                    {truncateLabel(pallet.clientName)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        <div className="trailer-canvas trailer-dnd-overlay">
          {validSlotEntries.map(([slotId, config]) => {
            const rect = slotCanvasRect(layout, slotBoundsFromConfig(config), 0);
            const pallet = slots[slotId] ?? null;
            const isConflict = conflictSlotIds.has(slotId);
            const menuProps = bindSlotMenu(slotId);

            const boxStyle = {
              left: pct(rect.x, canvasW),
              top: pct(rect.y, canvasH),
              width: pct(rect.width, canvasW),
              height: pct(rect.height, canvasH),
            };

            if (pallet) {
              return (
                <DraggablePallet
                  key={slotId}
                  slotId={slotId}
                  pallet={pallet}
                  boxStyle={boxStyle}
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
                boxStyle={boxStyle}
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
