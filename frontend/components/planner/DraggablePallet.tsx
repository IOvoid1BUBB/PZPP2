import { CSS } from "@dnd-kit/utilities";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { CSSProperties } from "react";

import type { PalletData } from "@/lib/types/load";

interface DraggablePalletProps {
  pallet: PalletData;
  slotId: string;
  left: number;
  top: number;
  width: number;
  height: number;
  isConflict: boolean;
  isShaking: boolean;
  menuProps?: Record<string, unknown>;
}

export function DraggablePallet({
  pallet,
  slotId,
  left,
  top,
  width,
  height,
  isConflict,
  isShaking,
  menuProps,
}: DraggablePalletProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: slotId,
    data: { slotId, pallet },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: slotId,
    data: { slotId },
  });

  const setRefs = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    setDropRef(node);
  };

  const style: CSSProperties = {
    left,
    top,
    width,
    height,
    transform: transform ? CSS.Translate.toString(transform) : undefined,
    zIndex: isDragging ? 20 : 2,
    ["--pallet-color" as string]: pallet.clientColor,
  };

  return (
    <div
      ref={setRefs}
      {...listeners}
      {...attributes}
      className={[
        "trailer-pallet",
        isConflict ? "trailer-pallet--conflict" : "",
        isShaking ? "trailer-pallet--shake" : "",
        isDragging ? "trailer-pallet--dragging" : "",
        isOver ? "trailer-pallet--over" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      {...menuProps}
    >
      <span className="trailer-pallet__label">{pallet.clientName}</span>
    </div>
  );
}
