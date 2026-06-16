const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export type DashboardNotificationType =
  | "free_space"
  | "time_window_risk"
  | "hot_offer";

export interface ActiveSessionSummary {
  session_id: string;
  vehicle_name: string;
  current_location: string;
  destination: string;
  lfil_pct: number;
  status: string;
  has_time_window_risk: boolean;
}

export interface DashboardNotification {
  id: string;
  type: DashboardNotificationType;
  title: string;
  body: string;
  link?: string;
  href?: string;
}

export interface DashboardResponse {
  today_net_profit_eur: number;
  today_net_profit_pln: number;
  avg_lfill_pct: number;
  empty_runs_pct: number;
  active_sessions: ActiveSessionSummary[];
  notifications: DashboardNotification[];
}

export async function fetchDashboard(): Promise<DashboardResponse> {
  const response = await fetch(`${API_BASE}/api/v1/dashboard`);
  if (!response.ok) {
    throw new Error(`Failed to fetch dashboard (${response.status})`);
  }
  return (await response.json()) as DashboardResponse;
}
