import type { PalletData, VehicleConfig } from "@/lib/types/load";

import { DraggablePallet } from "@/components/planner/DraggablePallet";
import { DroppableSlot } from "@/components/planner/DroppableSlot";

const SLOT_WIDTH_CM = 80;
const SLOT_HEIGHT_CM = 120;
const SCALE = 0.72;
const PADDING = 16;

interface TrailerCanvasProps {
  vehicle: VehicleConfig;
  slots: Record<string, PalletData | null>;
  conflictSlotIds: Set<string>;
  shakingSlotIds: Set<string>;
  activeSlotId: string | null;
  bindSlotMenu: (slotId: string) => Record<string, unknown>;
}

export function TrailerCanvas({
  vehicle,
  slots,
  conflictSlotIds,
  shakingSlotIds,
  activeSlotId,
  bindSlotMenu,
}: TrailerCanvasProps) {
  const slotWidth = SLOT_WIDTH_CM * SCALE;
  const slotHeight = SLOT_HEIGHT_CM * SCALE;
  const bedWidth = vehicle.trailerWidthCm * SCALE + PADDING * 2;
  const bedHeight = vehicle.trailerLengthCm * SCALE + PADDING * 2;

  return (
    <div
      className="trailer-canvas"
      style={{ width: "100%", maxWidth: bedWidth, height: bedHeight }}
      role="img"
      aria-label={`Plan załadunku ${vehicle.name}`}
    >
      <div
        className="trailer-canvas__frame"
        style={{
          left: 0,
          top: 0,
          width: bedWidth,
          height: bedHeight,
        }}
      />

      {Object.entries(vehicle.payloadSlots).map(([slotId, config]) => {
        const left = PADDING + config.xOffsetCm * SCALE;
        const top = PADDING + config.yOffsetCm * SCALE;
        const pallet = slots[slotId] ?? null;
        const isConflict = conflictSlotIds.has(slotId);
        const menuProps = bindSlotMenu(slotId);

        if (pallet) {
          return (
            <DraggablePallet
              key={slotId}
              slotId={slotId}
              pallet={pallet}
              left={left}
              top={top}
              width={slotWidth}
              height={slotHeight}
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
            width={slotWidth}
            height={slotHeight}
            isOver={activeSlotId === slotId}
            isConflict={isConflict}
            menuProps={menuProps}
          />
        );
      })}
    </div>
  );
}
