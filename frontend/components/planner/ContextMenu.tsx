import {
  useEffect,
  useRef,
  type MouseEvent,
  type PointerEvent,
} from "react";

import type { ContextMenuItem } from "@/lib/types/load";

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  slotId: string | null;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ open, x, y, slotId, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open || !slotId) {
    return null;
  }

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ top: y, left: x }}
      role="menu"
      aria-label="Akcje slotu"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={
            item.destructive
              ? "context-menu__item context-menu__item--danger"
              : "context-menu__item"
          }
          onClick={() => {
            item.action(slotId);
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

interface UseContextMenuTriggerOptions {
  onOpen: (slotId: string, x: number, y: number) => void;
  longPressMs?: number;
}

export function useContextMenuTrigger({
  onOpen,
  longPressMs = 500,
}: UseContextMenuTriggerOptions) {
  const timerRef = useRef<number | null>(null);
  const slotRef = useRef<string | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const bindSlot = (slotId: string) => ({
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault();
      onOpen(slotId, event.clientX, event.clientY);
    },
    onPointerDown: (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      slotRef.current = slotId;
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        if (slotRef.current === slotId) {
          onOpen(slotId, event.clientX, event.clientY);
        }
      }, longPressMs);
    },
    onPointerUp: clearTimer,
    onPointerCancel: clearTimer,
    onPointerLeave: clearTimer,
  });

  return { bindSlot };
}
