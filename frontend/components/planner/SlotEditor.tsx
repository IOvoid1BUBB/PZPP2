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

import { PalletLibrarySuspense } from "@/components/planner/PalletLibrary";

import { ProfitWaterfall } from "@/components/planner/ProfitWaterfall";

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

import {
  addOfferToSession,
  createSession,
  fetchSessionDetail,
  updateSessionStatus,
  removeOfferFromSession,
} from "@/lib/api/sessionClient";
import { buildCreateSessionParams } from "@/lib/fleet/resolveSessionOrigin";

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
import { validateDispatch } from "@/lib/load/dispatchValidation";

import type { ContextMenuItem, PalletData } from "@/lib/types/load";
import type { RankedOfferRow } from "@/lib/types/offers";
import { useLoadStore } from "@/lib/stores/loadStore";
import { useSessionStore } from "@/lib/stores/sessionStore";
import { useVehicleStore } from "@/lib/stores/vehicleStore";

const SHAKE_MS = 600;

/** Convert a RankedOfferRow (market mode, no session) into a PalletData for canvas placement. */
function offerRowToPallet(offer: RankedOfferRow): PalletData {
  return {
    id: `market-${offer.offer_id}`,
    offerId: offer.offer_id,
    clientId: offer.offer_id,
    clientName: offer.pickup_label ?? `#${offer.offer_id.slice(0, 6).toUpperCase()}`,
    clientColor: "#1a38f5",
    ldm: offer.ldm ?? 0,
    weightKg: offer.weight_kg ?? 0,
    dims: { wMm: 1200, dMm: 800, hMm: 1200 },
    stackable: offer.stackable ?? true,
    timeWindow: null,
  };
}

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

export function SlotEditor({
  onOfferAdded,
  onOfferRemoved,
  onRouteConfirmed,
  libraryRefreshSignal,
}: {
  onOfferAdded?: () => void;
  onOfferRemoved?: () => void;
  onRouteConfirmed?: () => void;
  /** Bumped by the planner page after a solver apply to refetch ranked offers. */
  libraryRefreshSignal?: number;
} = {}) {
  const hydrated = useClientHydrated();
  const {
    loading,
    error,
    vehicle: layoutVehicle,
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

  // Fall back to loadStore vehicle so TrailerCanvas renders even without a session
  const storeVehicle = useLoadStore((state) => state.vehicle);
  const vehicle = layoutVehicle ?? storeVehicle;

  const { showToast } = useToast();

  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);

  const [draggingSlotId, setDraggingSlotId] = useState<string | null>(null);

  const [draggingLibraryOffer, setDraggingLibraryOffer] =
    useState<RankedOfferRow | null>(null);

  const libraryAddRef = useRef<((offerId: string) => Promise<void>) | null>(
    null,
  );

  const libraryRemoveRef = useRef<((offerId: string) => void) | null>(null);

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
  const [driverProfileId, setDriverProfileId] = useState<string | undefined>(undefined);
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
        setDriverProfileId(detail.driver_profile.id);
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

  // BUG-06: driver profile selection. For an active session there is no backend
  // endpoint to re-assign the profile, so the change is applied at session
  // creation time (pre-session) and surfaced as info for an existing session.
  const handleDriverProfileChange = useCallback(
    (profileId: string) => {
      setDriverProfileId(profileId);
      if (sessionId) {
        showToast({
          type: "info",
          message:
            "Profil kierowcy ustawiany jest przy tworzeniu trasy — utwórz nową trasę, aby przeliczyć koszty.",
        });
      }
    },
    [sessionId, showToast],
  );

  const computedReadOnly =
    sessionStatus === "confirmed" || sessionStatus === "dispatched";

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

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    // A confirmed/dispatched route is read-only: only non-mutating inspection is
    // allowed, so the destructive/move actions are removed entirely.
    const detailsItem: ContextMenuItem = {
      label: "Szczegóły ładunku",
      action: openDrawer,
    };
    if (computedReadOnly) {
      return [detailsItem];
    }
    return [
      {
        label: "Usuń ładunek",
        destructive: true,
        action: (slotId) => {
          void removePallet(slotId);
        },
      },
      {
        label: "Odłóż na listę ofert",
        action: (slotId) => {
          const pallet = slots[slotId];
          if (!pallet) return;
          if (sessionId) {
            void removeOfferFromSession(sessionId, pallet.offerId)
              .then(() => {
                libraryRemoveRef.current?.(pallet.offerId);
                void removePallet(slotId);
                onOfferRemoved?.();
              })
              .catch(() => {
                showToast({ type: "error", message: "Nie udało się odłożyć oferty." });
              });
          } else {
            libraryRemoveRef.current?.(pallet.offerId);
            void removePallet(slotId);
            onOfferRemoved?.();
          }
        },
      },
      {
        label: "Przenieś do pierwszego wolnego slotu",
        action: (slotId) => {
          void handleMoveToFirstFree(slotId);
        },
      },
      detailsItem,
    ];
  }, [
    computedReadOnly,
    handleMoveToFirstFree,
    openDrawer,
    removePallet,
    sessionId,
    showToast,
    slots,
    onOfferRemoved,
  ]);

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

  /** Handle local offer placement from PalletLibrary "Dodaj" button in pre-session mode */
  const handleLocalOfferAdd = useCallback(
    (offer: RankedOfferRow) => {
      if (!vehicle) {
        showToast({ type: "error", message: "Wybierz pojazd przed dodaniem ładunku." });
        return;
      }
      const pallet = offerRowToPallet(offer);
      // Find first empty slot
      const slotIds = Object.keys(vehicle.payloadSlots);
      const currentSlots = useLoadStore.getState().slots;
      const targetSlot = slotIds.find((id) => !currentSlots[id]);
      if (!targetSlot) {
        showToast({ type: "error", message: "Brak wolnego miejsca na pace." });
        return;
      }
      useLoadStore.getState().assignPallet(targetSlot, pallet);
      onOfferAdded?.();
    },
    [vehicle, showToast, onOfferAdded],
  );

  const handleDragStart = (event: DragStartEvent) => {
    if (computedReadOnly) {
      return;
    }
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
    if (computedReadOnly) {
      return;
    }
    const dragData = event.active.data.current;
    const toSlot = event.over ? String(event.over.id) : null;

    setDraggingSlotId(null);
    setDraggingLibraryOffer(null);
    setActiveSlotId(null);

    if (dragData?.type === "library-offer") {
      if (!toSlot || !vehicle) return;

      const offer = dragData.offer as RankedOfferRow;
      const activeSessionId = useLoadStore.getState().sessionId ?? sessionId;

      if (!activeSessionId) {
        // Pre-session: place locally in Zustand
        const pallet = offerRowToPallet(offer);
        const currentSlots = useLoadStore.getState().slots;
        if (currentSlots[toSlot] !== null) {
          showToast({ type: "error", message: "To miejsce jest już zajęte." });
          return;
        }
        if (!canAssign(currentSlots, vehicle, pallet, toSlot, undefined)) {
          triggerShake(toSlot);
          showToast({
            type: "error",
            message: "Paleta nie pasuje do tego slotu.",
          });
          return;
        }
        useLoadStore.getState().assignPallet(toSlot, pallet);
        onOfferAdded?.();
        return;
      }

      if (!libraryAddRef.current) return;
      await libraryAddRef.current(offer.offer_id);
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

  const handleConfirmRoute = useCallback(async () => {
    if (!sessionId) {
      showToast({ type: "error", message: "Brak aktywnej sesji." });
      return;
    }

    // Walidacja biznesowa przed PATCH: pusta naczepa lub konflikty ułożenia
    // przerywają akcję z domenowym komunikatem (Toast).
    const validation = validateDispatch({
      conflicts,
      usedLdm: getUsedLdm(slots),
    });
    if (!validation.ok) {
      showToast({ type: "error", message: validation.message ?? "Nie można wysłać planu." });
      return;
    }

    setSaving(true);
    try {
      const saved = await persistSlots(slots);
      if (!saved) return;

      // Direct transition to confirmed (idempotent if already confirmed)
      if (sessionStatus !== "confirmed" && sessionStatus !== "dispatched") {
        if (sessionStatus === "draft") {
          await updateSessionStatus(sessionId, "optimizing");
        }
      }
      const confirmed = await updateSessionStatus(sessionId, "confirmed");
      setSessionStatus(confirmed.status);
      showToast({ type: "success", message: "Trasa zatwierdzona — widoczna w Fleet Manager." });
      onRouteConfirmed?.();
    } catch (err) {
      showToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Nie udało się potwierdzić sesji.",
      });
    } finally {
      setSaving(false);
    }
  }, [conflicts, onRouteConfirmed, persistSlots, sessionId, sessionStatus, showToast, slots]);

  // ── Two-step flow: Utwórz trasę → Utwórz sesję ────────────────────────────

  const setSessionId = useSessionStore((state) => state.setSessionId);
  const selectedVehicle = useVehicleStore((state) => state.selectedVehicle);
  const sessionOrigin = useVehicleStore((state) => state.sessionOrigin);
  const fleetVehicleId = useVehicleStore((state) => state.fleetVehicleId);
  const vehicleDbId = selectedVehicle?.id ?? storeVehicle?.id ?? null;

  /**
   * Collect placed offer IDs from canvas slots (pre-session mode).
   */
  const pendingOfferIds = useMemo(() => {
    if (sessionId) return [];
    const ids = new Set<string>();
    for (const pallet of Object.values(slots)) {
      if (pallet) ids.add(pallet.offerId);
    }
    return Array.from(ids);
  }, [sessionId, slots]);

  // Route preview mode: temp session created, showing route, awaiting confirmation
  const [routePreviewSessionId, setRoutePreviewSessionId] = useState<string | null>(null);
  const [routeConfirmed, setRouteConfirmed] = useState(false);
  const [creatingRoute, setCreatingRoute] = useState(false);

  /** Step 1: Create a temp session with all pending offers, show route preview */
  const handleCreateRoute = useCallback(async () => {
    if (!vehicleDbId) {
      showToast({ type: "error", message: "Wybierz pojazd przed stworzeniem trasy." });
      return;
    }
    if (pendingOfferIds.length === 0) {
      showToast({ type: "error", message: "Dodaj co najmniej jeden ładunek." });
      return;
    }

    setCreatingRoute(true);
    try {
      const session = await createSession(
        buildCreateSessionParams(vehicleDbId, {
          driverProfileId,
          origin: sessionOrigin ?? undefined,
          fleetVehicleId: fleetVehicleId ?? undefined,
        }),
      );
      for (const offerId of pendingOfferIds) {
        try {
          await addOfferToSession(session.id, offerId);
        } catch {
          // Skip offers that fail capacity — session is still useful
        }
      }
      setRoutePreviewSessionId(session.id);
    } catch (err) {
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "Nie udało się stworzyć trasy.",
      });
    } finally {
      setCreatingRoute(false);
    }
  }, [vehicleDbId, pendingOfferIds, driverProfileId, sessionOrigin, fleetVehicleId, showToast]);

  /** Step 2: Confirm the temp session as the real session */
  const handleCreateSession = useCallback(async () => {
    if (!routePreviewSessionId) return;

    setSaving(true);
    try {
      setSessionId(routePreviewSessionId);
      useLoadStore.getState().setSessionId(routePreviewSessionId);
      setRouteConfirmed(true);
      void reload();
      showToast({ type: "success", message: "Sesja utworzona — możesz teraz zarządzać trasą." });
      onRouteConfirmed?.();
    } catch (err) {
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "Nie udało się zapisać sesji.",
      });
    } finally {
      setSaving(false);
    }
  }, [routePreviewSessionId, setSessionId, reload, showToast, onRouteConfirmed]);

  /** Cancel route preview — discard temp session (leave draft in DB) */
  const handleCancelRoute = useCallback(() => {
    setRoutePreviewSessionId(null);
    setRouteConfirmed(false);
  }, []);

  // Determine VehicleHeader routeMode
  const routeMode = useMemo(() => {
    if (routeConfirmed || (sessionId && sessionStatus === "confirmed")) return "confirmed" as const;
    if (routePreviewSessionId) return "route-preview" as const;
    if (!sessionId && pendingOfferIds.length > 0) return "create-route" as const;
    return "none" as const;
  }, [routeConfirmed, sessionId, sessionStatus, routePreviewSessionId, pendingOfferIds.length]);

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
    // No vehicle at all — show library + empty placeholder
    return (
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
        <PalletLibrarySuspense
          sessionId={sessionId}
          loadedOfferIds={loadedOfferIds}
          refreshSignal={libraryRefreshSignal}
          onLocalOfferAdd={handleLocalOfferAdd}
          onRegisterAddOffer={(addOffer) => {
            libraryAddRef.current = addOffer;
          }}
          onRegisterRemoveOffer={(removeOffer) => {
            libraryRemoveRef.current = removeOffer;
          }}
          onOfferAdded={() => { void reload(); onOfferAdded?.(); }}
        />
        <div className="flex flex-col gap-4">
          <VehicleHeader />
          <div className="rounded-2xl border border-dashed border-ui-border/50 bg-ui-surface p-8 text-center">
            <p className="text-sm text-ui-secondary">
              Wybierz pojazd powyżej, aby zobaczyć naczepę.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const drawerPallet = drawerSlotId ? slots[drawerSlotId] : null;
  const overlayPallet = draggingSlotId ? slots[draggingSlotId] : null;
  const overlayColors = overlayPallet
    ? getCompanyColorPair(overlayPallet.clientId || overlayPallet.offerId)
    : draggingLibraryOffer
      ? getCompanyColorPair(draggingLibraryOffer.offer_id)
      : null;

  const usedWeightKg = getUsedWeight(slots);
  const usedLdm = getUsedLdm(slots);

  // Effective session id for PalletLibrary and map (may be temp preview session)
  const effectiveSessionId = sessionId ?? routePreviewSessionId;

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
          {/* PalletLibrary: shows ranked offers with session, raw market offers without */}
          <PalletLibrarySuspense
            sessionId={effectiveSessionId}
            vehicleId={vehicleDbId}
            loadedOfferIds={loadedOfferIds}
            refreshSignal={libraryRefreshSignal}
            onLocalOfferAdd={handleLocalOfferAdd}
            onRegisterAddOffer={(addOffer) => {
              libraryAddRef.current = addOffer;
            }}
            onRegisterRemoveOffer={(removeOffer) => {
              libraryRemoveRef.current = removeOffer;
            }}
            onOfferAdded={() => { void reload(); onOfferAdded?.(); }}
            onOfferRemoved={() => onOfferRemoved?.()}
          />

          <div className="flex min-w-0 flex-col gap-5">
            <VehicleHeader
              driverName={driverName}
              itemsCount={loadedCount}
              usedWeightKg={usedWeightKg}
              maxWeightKg={vehicle.maxWeightKg}
              usedLdm={usedLdm}
              maxLdm={vehicle.maxLdm}
              profitEur={profitData ? Math.round(profitData.netProfitEur) : undefined}
              saving={saving || creatingRoute}
              onConfirm={sessionId && !computedReadOnly ? () => void handleConfirmRoute() : undefined}
              onCreateRoute={routeMode === "create-route" ? () => void handleCreateRoute() : undefined}
              onCreateSession={routeMode === "route-preview" ? () => void handleCreateSession() : undefined}
              onCancelRoute={routeMode === "route-preview" ? handleCancelRoute : undefined}
              sessionId={effectiveSessionId ?? undefined}
              sessionStatus={sessionStatus}
              driverProfileId={driverProfileId}
              onDriverProfileChange={handleDriverProfileChange}
              routeMode={routeMode}
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
                isReadOnly={computedReadOnly}
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
