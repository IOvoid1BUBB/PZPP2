import type { APIRequestContext, Page } from "@playwright/test";

/**
 * E2E helpers (FEAT-11).
 *
 * Sessions are created through the backend API (proxied via the Next.js
 * `/api/*` rewrite) and then handed to the UI by seeding the persisted Zustand
 * store (`load-store` in sessionStorage) before navigation.
 */

const API_PREFIX = "/api/v1";

export interface CreatedSession {
  sessionId: string;
  vehicleId: string;
  offerCount: number;
}

interface VehicleApiRecord {
  id: string;
  type: string;
}

interface DriverProfileApiRecord {
  id: string;
}

/**
 * Create a draft session with a simulated market of `count` offers.
 * Picks the largest vehicle (man_solo) so the solver has room to consolidate.
 */
export async function createSessionWithOffers(
  request: APIRequestContext,
  count = 50,
): Promise<CreatedSession> {
  const vehiclesRes = await request.get(`${API_PREFIX}/vehicles`);
  if (!vehiclesRes.ok()) {
    throw new Error(`GET /vehicles failed: ${vehiclesRes.status()}`);
  }
  const vehicles = (await vehiclesRes.json()) as VehicleApiRecord[];
  const vehicle =
    vehicles.find((v) => v.type === "man_solo") ?? vehicles[0];
  if (!vehicle) {
    throw new Error("No vehicles available from backend seed.");
  }

  let driverProfileId: string | undefined;
  const profilesRes = await request.get(`${API_PREFIX}/driver-profiles`);
  if (profilesRes.ok()) {
    const profiles = (await profilesRes.json()) as DriverProfileApiRecord[];
    driverProfileId = profiles[0]?.id;
  }

  const sessionRes = await request.post(`${API_PREFIX}/sessions`, {
    data: {
      vehicle_id: vehicle.id,
      ...(driverProfileId ? { driver_profile_id: driverProfileId } : {}),
      origin_lon: 21.01,
      origin_lat: 52.22,
      target_region_bbox: [18.0, 49.0, 24.0, 55.0],
    },
  });
  if (!sessionRes.ok()) {
    throw new Error(`POST /sessions failed: ${sessionRes.status()}`);
  }
  const session = (await sessionRes.json()) as { id: string };

  const simulateRes = await request.post(
    `${API_PREFIX}/sessions/${session.id}/simulate?count=${count}`,
  );
  if (!simulateRes.ok()) {
    throw new Error(`POST /simulate failed: ${simulateRes.status()}`);
  }

  return { sessionId: session.id, vehicleId: vehicle.id, offerCount: count };
}

/**
 * Seed the persisted planner store so /planner opens directly on the given
 * session (skipping the manual vehicle-selection step). Must run before the
 * page scripts hydrate, so this uses `addInitScript`.
 */
export async function seedSession(page: Page, sessionId: string): Promise<void> {
  await page.addInitScript((id: string) => {
    const payload = {
      state: {
        slots: {},
        vehicle: null,
        sessionId: id,
        sessionOfferIds: [],
      },
      version: 0,
    };
    window.sessionStorage.setItem("load-store", JSON.stringify(payload));
  }, sessionId);
}
