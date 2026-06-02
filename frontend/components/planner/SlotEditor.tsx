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

import { useCallback, useMemo, useState, type CSSProperties } from "react";



import { OfferSidebar } from "@/components/planner/OfferSidebar";

import { DriverHoursWarning } from "@/components/planner/DriverHoursWarning";

import { ProfitWaterfall } from "@/components/planner/ProfitWaterfall";

import { ContextMenu, useContextMenuTrigger } from "@/components/planner/ContextMenu";

import { TrailerCanvas } from "@/components/planner/TrailerCanvas";

import { VehicleHeader } from "@/components/planner/VehicleHeader";

import { Drawer } from "@/components/ui/Drawer";

import { useToast } from "@/components/ui/Toast";

import { usePlannerLayout } from "@/hooks/usePlannerLayout";

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

  const {

    loading,

    error,

    vehicle,

    slots,

    conflicts,

    conflictSlotIds,

    movePallet,

    removePallet,

    moveToFirstFree,

    persistSlots,

    reload,

  } = usePlannerLayout();

  const { showToast } = useToast();



  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);

  const [draggingSlotId, setDraggingSlotId] = useState<string | null>(null);

  const [shakingSlotIds, setShakingSlotIds] = useState<Set<string>>(new Set());

  const [drawerSlotId, setDrawerSlotId] = useState<string | null>(null);

  const [menuState, setMenuState] = useState<{ slotId: string; x: number; y: number } | null>(

    null,

  );

  const [saving, setSaving] = useState(false);



  const sensors = useSensors(

    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),

    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),

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

          message: result.message ?? "Brak miejsca: przekroczono LDM lub tonaż.",

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



  const handleDragStart = (event: DragStartEvent) => {

    setDraggingSlotId(String(event.active.id));

  };



  const handleDragEnd = async (event: DragEndEvent) => {

    const fromSlot = String(event.active.id);

    const toSlot = event.over ? String(event.over.id) : null;

    setDraggingSlotId(null);

    setActiveSlotId(null);



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

          message: result.message ?? "Brak miejsca: przekroczono LDM lub tonaż.",

        });

      }

    } finally {

      setSaving(false);

    }

  };



  if (loading) {

    return <p className="planner-empty">Wczytywanie layoutu…</p>;

  }



  if (error) {

    return (

      <div className="planner-empty">

        <p>{error}</p>

        <button type="button" className="button button--primary" onClick={() => void reload()}>

          Spróbuj ponownie

        </button>

      </div>

    );

  }



  if (!vehicle) {

    return <p className="planner-empty">Brak przypisanego pojazdu.</p>;

  }



  const drawerPallet = drawerSlotId ? slots[drawerSlotId] : null;

  const displayVehicleName = vehicle.name.replace("Bus 8m", "Renault master (8EP)");

  const loadedCount = Object.values(slots).filter((pallet) => pallet !== null).length;

  const usedWeightKg = getUsedWeight(slots);

  const usedLdm = getUsedLdm(slots);



  return (

    <section className="slot-editor">

      <div className="planning-lab__layout">

        <OfferSidebar slots={slots} />



        <div className="planning-lab__main">

          <DriverHoursWarning />

          <VehicleHeader

            name={displayVehicleName}

            driverName="Jan Kowalski"

            itemsCount={loadedCount}

            usedWeightKg={usedWeightKg}

            maxWeightKg={vehicle.maxWeightKg}

            usedLdm={usedLdm}

            maxLdm={vehicle.maxLdm}

            saving={saving}

            onSave={() => void persistSlots(slots)}

          />



          {conflicts.length > 0 && (

            <ul className="slot-editor__conflicts" aria-live="polite">

              {conflicts.map((conflict) => (

                <li key={`${conflict.type}-${conflict.affectedSlotIds.join("-")}`}>

                  {conflict.message}

                </li>

              ))}

            </ul>

          )}



          <div className="trailer-stage">

            <DndContext

              sensors={sensors}

              onDragStart={handleDragStart}

              onDragEnd={(event) => void handleDragEnd(event)}

              onDragOver={({ over }) => setActiveSlotId(over ? String(over.id) : null)}

            >

              <TrailerCanvas

                vehicle={vehicle}

                slots={slots}

                conflictSlotIds={conflictSlotIds}

                shakingSlotIds={shakingSlotIds}

                activeSlotId={activeSlotId}

                bindSlotMenu={bindSlot}

              />



              <DragOverlay dropAnimation={null}>

                {draggingSlotId && slots[draggingSlotId] ? (

                  <div

                    className="drag-overlay-card"

                    style={

                      {

                        "--pallet-color": slots[draggingSlotId]!.clientColor,

                      } as CSSProperties

                    }

                  >

                    <strong>{slots[draggingSlotId]!.clientName}</strong>

                    <span>

                      {slots[draggingSlotId]!.ldm.toFixed(1)} LDM · {slots[draggingSlotId]!.weightKg}{" "}

                      kg

                    </span>

                  </div>

                ) : null}

              </DragOverlay>

            </DndContext>

          </div>



          <ProfitWaterfall />

        </div>

      </div>



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


