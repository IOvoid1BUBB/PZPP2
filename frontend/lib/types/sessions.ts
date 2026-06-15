export interface Session {
  id: string;
  status: "draft" | "running" | "completed";
  createdAt: string;
  plannedStops: number;
  assignedOffers: number;
  expectedProfitEur: number;
}
