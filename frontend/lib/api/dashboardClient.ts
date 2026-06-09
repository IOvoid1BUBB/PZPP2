const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export interface DashboardKpi {
  active_sessions: number;
  total_sessions: number;
  total_estimated_profit_eur: number;
  average_fill_pct: number;
  market_offers_count: number;
}

export interface DashboardSessionSummary {
  id: string;
  status: string;
  created_at: string;
  vehicle_name: string | null;
  stop_count: number;
  offer_count: number;
  estimated_net_profit_eur: number | null;
}

export interface DashboardResponse {
  kpis: DashboardKpi;
  recent_sessions: DashboardSessionSummary[];
}

export async function fetchDashboard(): Promise<DashboardResponse> {
  const response = await fetch(`${API_BASE}/api/v1/dashboard`);
  if (!response.ok) {
    throw new Error(`Nie udało się pobrać dashboardu (${response.status})`);
  }
  return (await response.json()) as DashboardResponse;
}
