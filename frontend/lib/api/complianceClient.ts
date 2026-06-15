/**
 * @file complianceClient.ts
 * Klient API walidacji czasu pracy kierowcy (EU 561/2006).
 * GET /api/v1/sessions/{id}/driver-compliance
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export interface DrivingDay {
  day_number: number;
  driving_hours: number;
  working_minutes: number;
  violations: string[];
}

export interface DriverComplianceResult {
  days: DrivingDay[];
  total_days: number;
  compliant: boolean;
  violations: string[];
  recommended_overnight_stops: number[];
}

export async function fetchDriverCompliance(
  sessionId: string,
): Promise<DriverComplianceResult> {
  const response = await fetch(
    `${API_BASE}/api/v1/sessions/${sessionId}/driver-compliance`,
  );
  if (!response.ok) {
    throw new Error(
      `Nie udało się pobrać walidacji czasu pracy (${response.status})`,
    );
  }
  return (await response.json()) as DriverComplianceResult;
}
