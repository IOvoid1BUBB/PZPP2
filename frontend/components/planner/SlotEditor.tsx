import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
  type CSSProperties,
} from "react";

import { useClientHydrated } from "@/hooks/useClientHydrated";

import { PalletLibrary } from "@/components/planner/PalletLibrary";

import { ProfitWaterfall } from "@/components/analytics/ProfitWaterfall";

import {
  ContextMenu,
  useContextMenuTrigger,
} from "@/components/planner/ContextMenu";

import { TrailerCanvas } from "@/components/planner/TrailerCanvas";

import { VehicleHeader } from "@/components/planner/VehicleHeader";

import { Drawer } from "@/components/ui/Drawer";

import { useToast } from "@/components/ui/Toast";

import { usePlannerLayout } from "@/hooks/usePlannerLayout";
import { useProfitBreakdown } from "@/hooks/useProfitBreakdown";

import { fetchSessionDetail, updateSessionStatus } from "@/lib/api/sessionClient";

import { getCompanyColorPair } from "@/lib/colors/companyColors";
import {
  assignBlockedByFootprint,
  assignBlockedBySize,
  canAssign,
  canSwap,
  getUsedLdm,
  getUsedWeight,
  palletFitsSlot,
} from "@/lib/load/capacity";

import type { ContextMenuItem, PalletData } from "@/lib/types/load";
import type { RankedOfferRow } from "@/lib/types/offers";

const SHAKE_MS = 600;

function PalletDetails({ pallet }: { pallet: PalletData }) {
  return (
    <dl className="pallet-details">
      <div>
        <dt>Klient</dt>

        <dd>{pallet.clientName}</dd>
      </div>

      <div>
        <dt>Oferta</dt>

        <dd>{pallet.offerId}</dd>
      </div>

      <div>
        <dt>LDM</dt>

        <dd>{pallet.ldm.toFixed(1)}</dd>
      </div>

      <div>
        <dt>Masa</dt>

        <dd>{pallet.weightKg} kg</dd>
      </div>

      <div>
        <dt>Wymiary (mm)</dt>

        <dd>
          {pallet.dims.wMm} × {pallet.dims.dMm} × {pallet.dims.hMm}
        </dd>
      </div>

      <div>
        <dt>Stackowalna</dt>

        <dd>{pallet.stackable ? "Tak" : "Nie"}</dd>
      </div>

      <div>
        <dt>Okno czasowe</dt>

        <dd>
          {pallet.timeWindow
            ? `${new Date(pallet.timeWindow.open).toLocaleString("pl-PL")} – ${new Date(pallet.timeWindow.close).toLocaleString("pl-PL")}`
            : "Brak"}
        </dd>
      </div>
    </dl>
  );
}

export function SlotEditor() {
  const hydrated = useClientHydrated();
  const {
    loading,

    error,

    vehicle,

    slots,

    conflicts,

    conflictSlotIds,

    sessionId,

    movePallet,

    removePallet,

    moveToFirstFree,

    persistSlots,

    reload,
  } = usePlannerLayout();

  const { showToast } = useToast();

  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);

  const [draggingSlotId, setDraggingSlotId] = useState<string | null>(null);

  const [draggingLibraryOffer, setDraggingLibraryOffer] =
    useState<RankedOfferRow | null>(null);

  const libraryAddRef = useRef<((offerId: string) => Promise<void>) | null>(
    null,
  );

  const [shakingSlotIds, setShakingSlotIds] = useState<Set<string>>(new Set());

  const [drawerSlotId, setDrawerSlotId] = useState<string | null>(null);

  const [menuState, setMenuState] = useState<{
    slotId: string;
    x: number;
    y: number;
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [driverName, setDriverName] = useState("—");
  const [sessionStatus, setSessionStatus] = useState<string>("draft");
  const { data: profitData } = useProfitBreakdown(sessionId);

  useEffect(() => {
    if (!sessionId) {
      setDriverName("—");
      setSessionStatus("draft");
      return;
    }

    let cancelled = false;
    void fetchSessionDetail(sessionId)
      .then((detail) => {
        if (cancelled) {
          return;
        }
        setDriverName(detail.driver_profile.name);
        setSessionStatus(detail.status);
      })
      .catch(() => {
        if (!cancelled) {
          setDriverName("—");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const isReadOnly = sessionStatus === "confirmed" || sessionStatus === "dispatched";

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),

    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 8 },
    }),
  );

  const triggerShake = useCallback((slotId: string) => {
    setShakingSlotIds((current) => new Set(current).add(slotId));

    window.setTimeout(() => {
      setShakingSlotIds((current) => {
        const next = new Set(current);

        next.delete(slotId);

        return next;
      });
    }, SHAKE_MS);
  }, []);

  const handleMoveToFirstFree = useCallback(
    async (slotId: string) => {
      const result = await moveToFirstFree(slotId);

      if (!result.ok) {
        triggerShake(slotId);

        showToast({
          type: "error",

          message:
            result.message ?? "Brak miejsca: przekroczono LDM lub tonaż.",
        });
      }
    },

    [moveToFirstFree, showToast, triggerShake],
  );

  const openDrawer = useCallback((slotId: string) => {
    setDrawerSlotId(slotId);
  }, []);

  const contextMenuItems = useMemo<ContextMenuItem[]>(
    () => [
      {
        label: "Usuń ładunek",

        destructive: true,

        action: (slotId) => {
          void removePallet(slotId);
        },
      },

      {
        label: "Przenieś do pierwszego wolnego slotu",

        action: (slotId) => {
          void handleMoveToFirstFree(slotId);
        },
      },

      {
        label: "Szczegóły ładunku",

        action: openDrawer,
      },
    ],

    [handleMoveToFirstFree, openDrawer, removePallet],
  );

  const { bindSlot } = useContextMenuTrigger({
    onOpen: (slotId, x, y) => {
      if (!slots[slotId]) {
        return;
      }

      setMenuState({ slotId, x, y });
    },
  });

  const loadedOfferIds = useMemo(() => {
    const ids = new Set<string>();
    for (const pallet of Object.values(slots)) {
      if (pallet) {
        ids.add(pallet.offerId);
      }
    }
    return ids;
  }, [slots]);

  const handleDragStart = (event: DragStartEvent) => {
    const dragData = event.active.data.current;
    if (dragData?.type === "library-offer") {
      setDraggingLibraryOffer(dragData.offer as RankedOfferRow);
      setDraggingSlotId(null);
      return;
    }

    setDraggingSlotId(String(event.active.id));
    setDraggingLibraryOffer(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const dragData = event.active.data.current;
    const toSlot = event.over ? String(event.over.id) : null;

    setDraggingSlotId(null);
    setDraggingLibraryOffer(null);
    setActiveSlotId(null);

    if (dragData?.type === "library-offer") {
      if (!toSlot || !libraryAddRef.current) {
        return;
      }

      await libraryAddRef.current(String(dragData.offerId));
      return;
    }

    const fromSlot = String(event.active.id);

    if (!toSlot || fromSlot === toSlot || !vehicle) {
      return;
    }

    const sourcePallet = slots[fromSlot];

    if (!sourcePallet) {
      return;
    }

    const targetOccupied = Boolean(slots[toSlot]);

    const footprintBlocked = assignBlockedByFootprint(
      slots,
      vehicle,
      toSlot,
      fromSlot,
    );

    const sizeBlocked = targetOccupied
      ? Boolean(
          vehicle &&
          (!palletFitsSlot(sourcePallet, vehicle.payloadSlots[toSlot]!) ||
            !palletFitsSlot(slots[toSlot]!, vehicle.payloadSlots[fromSlot]!)),
        )
      : assignBlockedBySize(sourcePallet, vehicle, toSlot);

    const allowed = targetOccupied
      ? canSwap(slots, vehicle, fromSlot, toSlot)
      : canAssign(slots, vehicle, sourcePallet, toSlot, fromSlot);

    if (!allowed) {
      triggerShake(toSlot);

      showToast({
        type: "error",
        message: footprintBlocked
          ? "To miejsce nachodzi na inną paletę."
          : sizeBlocked
            ? "Paleta nie mieści się w tym slocie."
            : "Brak miejsca: przekroczono LDM lub tonaż.",
      });

      return;
    }

    setSaving(true);

    try {
      const result = await movePallet(fromSlot, toSlot);

      if (!result.ok) {
        triggerShake(toSlot);

        showToast({
          type: "error",

          message:
            result.message ?? "Brak miejsca: przekroczono LDM lub tonaż.",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const loadedCount = useMemo(
    () => Object.values(slots).filter((pallet) => pallet !== null).length,
    [slots],
  );

  const handleSendToDriver = useCallback(async () => {
    if (!sessionId) {
      showToast({ type: "error", message: "Brak aktywnej sesji." });
      return;
    }
    if (loadedCount === 0) {
      showToast({ type: "error", message: "Dodaj co najmniej jedną ofertę przed wysłaniem." });
      return;
    }
    if (conflicts.length > 0) {
      showToast({ type: "error", message: "Usuń konflikty layoutu przed wysłaniem." });
      return;
    }

    setSaving(true);
    try {
      const saved = await persistSlots(slots);
      if (!saved) {
        return;
      }

      if (sessionStatus === "draft") {
        await updateSessionStatus(sessionId, "optimizing");
      }
      const confirmed = await updateSessionStatus(sessionId, "confirmed");
      setSessionStatus(confirmed.status);
      showToast({ type: "success", message: "Sesja potwierdzona i wysłana do kierowcy." });
    } catch (err) {
      showToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Nie udało się potwierdzić sesji.",
      });
    } finally {
      setSaving(false);
    }
  }, [conflicts.length, loadedCount, persistSlots, sessionId, sessionStatus, showToast, slots]);

  if (!hydrated || loading) {
    return <p className="planner-empty">Wczytywanie layoutu…</p>;
  }

  if (error) {
    return (
      <div className="planner-empty">
        <p>{error}</p>

        <button
          type="button"
          className="button button--primary"
          onClick={() => void reload()}
        >
          Spróbuj ponownie
        </button>
      </div>
    );
  }

  if (!vehicle) {
    return <p className="planner-empty">Brak przypisanego pojazdu.</p>;
  }

  const drawerPallet = drawerSlotId ? slots[drawerSlotId] : null;
  const overlayPallet = draggingSlotId ? slots[draggingSlotId] : null;
  const overlayColors = overlayPallet
    ? getCompanyColorPair(overlayPallet.clientId || overlayPallet.offerId)
    : draggingLibraryOffer
      ? getCompanyColorPair(draggingLibraryOffer.offer_id)
      : null;

  const displayVehicleName = vehicle.name.replace(
    "Bus 8m",
    "Renault master (8EP)",
  );

  const usedWeightKg = getUsedWeight(slots);

  const usedLdm = getUsedLdm(slots);

  return (
    <section className="slot-editor">
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={(event) => void handleDragEnd(event)}
        onDragOver={({ over }) =>
          setActiveSlotId(over ? String(over.id) : null)
        }
      >
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
          {sessionId ? (
            <PalletLibrary
              sessionId={sessionId}
              loadedOfferIds={loadedOfferIds}
              onRegisterAddOffer={(addOffer) => {
                libraryAddRef.current = addOffer;
              }}
              onOfferAdded={() => void reload()}
            />
          ) : (
            <aside className="offer-sidebar" aria-label="Biblioteka ofert">
              <p className="pallet-library__status">
                Wybierz pojazd, aby wczytać bibliotekę ofert.
              </p>
            </aside>
          )}

          <div className="flex min-w-0 flex-col gap-5">
            <VehicleHeader
              name={displayVehicleName}
              driverName={driverName}
              itemsCount={loadedCount}
              usedWeightKg={usedWeightKg}
              maxWeightKg={vehicle.maxWeightKg}
              usedLdm={usedLdm}
              maxLdm={vehicle.maxLdm}
              profitEur={Math.round(profitData.netProfitEur)}
              saving={saving}
              onSave={isReadOnly ? undefined : () => void handleSendToDriver()}
            />

            {conflicts.length > 0 && (
              <ul className="slot-editor__conflicts" aria-live="polite">
                {conflicts.map((conflict) => (
                  <li
                    key={`${conflict.type}-${conflict.affectedSlotIds.join("-")}`}
                  >
                    {conflict.message}
                  </li>
                ))}
              </ul>
            )}

            <div className="trailer-stage">
              <TrailerCanvas
                vehicle={vehicle}
                slots={slots}
                conflictSlotIds={conflictSlotIds}
                shakingSlotIds={shakingSlotIds}
                activeSlotId={activeSlotId}
                bindSlotMenu={bindSlot}
              />
            </div>

            <ProfitWaterfall />
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {overlayPallet && overlayColors ? (
            <div
              className="drag-overlay-card"
              style={
                {
                  "--pallet-intense": overlayColors.intense,
                  "--pallet-muted": overlayColors.muted,
                } as CSSProperties
              }
            >
              <strong>{overlayPallet.clientName}</strong>
              <span>
                {overlayPallet.ldm.toFixed(1)} LDM · {overlayPallet.weightKg} kg
              </span>
            </div>
          ) : draggingLibraryOffer && overlayColors ? (
            <div
              className="drag-overlay-card drag-overlay-card--library"
              style={
                {
                  "--pallet-intense": overlayColors.intense,
                  "--pallet-muted": overlayColors.muted,
                } as CSSProperties
              }
            >
              <strong>
                #{draggingLibraryOffer.offer_id.slice(0, 8).toUpperCase()}
              </strong>
              <span>
                Score {draggingLibraryOffer.total_score.toFixed(2)} ·{" "}
                {(draggingLibraryOffer.ldm ?? 0).toFixed(1)} LDM
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <ContextMenu
        open={Boolean(menuState)}
        x={menuState?.x ?? 0}
        y={menuState?.y ?? 0}
        slotId={menuState?.slotId ?? null}
        items={contextMenuItems}
        onClose={() => setMenuState(null)}
      />

      <Drawer
        open={Boolean(drawerPallet)}
        title="Szczegóły ładunku"
        onClose={() => setDrawerSlotId(null)}
      >
        {drawerPallet ? <PalletDetails pallet={drawerPallet} /> : null}
      </Drawer>
    </section>
  );
}
