import { CSS } from "@dnd-kit/utilities";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import { getCompanyColorPair } from "@/lib/colors/companyColors";
import type { PalletData } from "@/lib/types/load";

type PointerHandler = (event: ReactPointerEvent<HTMLDivElement>) => void;

function asPointerHandler(handler: unknown): PointerHandler | undefined {
  return typeof handler === "function"
    ? (handler as PointerHandler)
    : undefined;
}

function chainPointerHandlers(...handlers: Array<PointerHandler | undefined>) {
  return (event: ReactPointerEvent<HTMLDivElement>) => {
    for (const handler of handlers) {
      handler?.(event);
    }
  };
}

interface DraggablePalletProps {
  pallet: PalletData;
  slotId: string;
  boxStyle: Pick<CSSProperties, "left" | "top" | "width" | "height">;
  isConflict: boolean;
  isShaking: boolean;
  isReadOnly?: boolean;
  menuProps?: Record<string, unknown>;
}

export function DraggablePallet({
  pallet,
  slotId,
  boxStyle,
  isConflict,
  isShaking,
  isReadOnly = false,
  menuProps,
}: DraggablePalletProps) {
  const companyColors = getCompanyColorPair(pallet.clientId || pallet.offerId);

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: slotId,
      data: { slotId, pallet },
      disabled: isReadOnly,
    });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: slotId,
    data: { slotId },
  });

  const setRefs = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    setDropRef(node);
  };

  const {
    onPointerDown: menuPointerDown,
    onPointerUp: menuPointerUp,
    onPointerCancel: menuPointerCancel,
    onPointerLeave: menuPointerLeave,
    ...restMenuProps
  } = menuProps ?? {};

  const style: CSSProperties = {
    ...boxStyle,
    transform: transform ? CSS.Translate.toString(transform) : undefined,
    zIndex: isDragging ? 20 : 2,
    ["--pallet-intense" as string]: companyColors.intense,
    ["--pallet-muted" as string]: companyColors.muted,
    touchAction: "none",
  };

  return (
    <div
      ref={setRefs}
      data-testid="slot-occupied"
      data-offer-id={pallet.offerId}
      draggable={isReadOnly ? false : undefined}
      {...attributes}
      {...restMenuProps}
      onPointerDown={chainPointerHandlers(
        isReadOnly ? undefined : asPointerHandler(listeners?.onPointerDown),
        asPointerHandler(menuPointerDown),
      )}
      onPointerUp={chainPointerHandlers(
        isReadOnly ? undefined : asPointerHandler(listeners?.onPointerUp),
        asPointerHandler(menuPointerUp),
      )}
      onPointerCancel={chainPointerHandlers(
        isReadOnly ? undefined : asPointerHandler(listeners?.onPointerCancel),
        asPointerHandler(menuPointerCancel),
      )}
      onPointerLeave={chainPointerHandlers(
        isReadOnly ? undefined : asPointerHandler(listeners?.onPointerLeave),
        asPointerHandler(menuPointerLeave),
      )}
      className={[
        "trailer-pallet",
        isReadOnly ? "trailer-pallet--readonly" : "",
        isConflict ? "trailer-pallet--conflict" : "",
        isShaking ? "trailer-pallet--shake" : "",
        isDragging ? "trailer-pallet--dragging" : "",
        isOver ? "trailer-pallet--over" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      <span className="trailer-pallet__label">{pallet.clientName}</span>
    </div>
  );
}
