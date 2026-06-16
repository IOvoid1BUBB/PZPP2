import { useDroppable } from "@dnd-kit/core";
import type { CSSProperties } from "react";

interface DroppableSlotProps {
  slotId: string;
  boxStyle: Pick<CSSProperties, "left" | "top" | "width" | "height">;
  isOver: boolean;
  isConflict: boolean;
  isReadOnly?: boolean;
  menuProps?: Record<string, unknown>;
}

export function DroppableSlot({
  slotId,
  boxStyle,
  isOver,
  isConflict,
  isReadOnly = false,
  menuProps,
}: DroppableSlotProps) {
  const { setNodeRef, isOver: isDropOver } = useDroppable({
    id: slotId,
    data: { slotId },
    disabled: isReadOnly,
  });

  const highlighted = isOver || isDropOver;

  return (
    <div
      ref={setNodeRef}
      data-testid="slot"
      draggable={isReadOnly ? false : undefined}
      className={[
        "trailer-slot",
        highlighted ? "trailer-slot--over" : "",
        isConflict ? "conflict-slot" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={boxStyle}
      aria-label={`Slot ${slotId}`}
      {...menuProps}
    />
  );
}
