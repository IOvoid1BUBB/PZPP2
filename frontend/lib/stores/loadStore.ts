/**
 * Zustand load store — owned by another task.
 *
 * SlotEditor currently uses `hooks/usePlannerLayout.ts` + `/api/v1/planner/*`.
 * When the global store lands, wire SlotEditor to `useLoadStore` here.
 */

export type {
  ContextMenuItem,
  LoadLayoutResponse,
  PalletData,
  SlotConflict,
  VehicleConfig,
} from "@/lib/types/load";
