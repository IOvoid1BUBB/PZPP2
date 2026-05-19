import { useDroppable } from "@dnd-kit/core";
import type { CSSProperties } from "react";

interface DroppableSlotProps {
  slotId: string;
  left: number;
  top: number;
  width: number;
  height: number;
  isOver: boolean;
  isConflict: boolean;
  menuProps?: Record<string, unknown>;
}

export function DroppableSlot({
  slotId,
  left,
  top,
  width,
  height,
  isOver,
  isConflict,
  menuProps,
}: DroppableSlotProps) {
  const { setNodeRef, isOver: isDropOver } = useDroppable({
    id: slotId,
    data: { slotId },
  });

  const highlighted = isOver || isDropOver;

  const style: CSSProperties = {
    left,
    top,
    width,
    height,
  };

  return (
    <div
      ref={setNodeRef}
      className={[
        "trailer-slot",
        highlighted ? "trailer-slot--over" : "",
        isConflict ? "conflict-slot" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      aria-label={`Slot ${slotId}`}
      {...menuProps}
    />
  );
}
