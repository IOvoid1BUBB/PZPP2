import { Badge } from "@/components/ui/Badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";

const KPI = [
  {
    label: "Expected Profit",
    value: "21 400 EUR",
    tone: "green" as const,
    progress: 78,
  },
  { label: "Delay Risk", value: "12%", tone: "amber" as const, progress: 34 },
  { label: "Overload Risk", value: "4%", tone: "red" as const, progress: 12 },
];

export default function AnalyticsPage() {
  return (
    <section className="grid gap-4">
      <header className="mb-2">
        <h1 className="text-2xl font-semibold">Profit Dashboard</h1>
        <p className="text-sm text-[var(--ui-text-secondary)]">
          Operacyjne KPI dla aktywnych sesji konsolidacji.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {KPI.map((item) => (
          <Card key={item.label}>
            <div className="mb-2 flex items-center justify-between">
              <CardTitle>{item.label}</CardTitle>
              <Badge
                variant={
                  item.tone === "green"
                    ? "success"
                    : item.tone === "amber"
                      ? "warning"
                      : "danger"
                }
              >
                Live
              </Badge>
            </div>
            <CardDescription>{item.value}</CardDescription>
            <div className="mt-3">
              <ProgressBar value={item.progress} tone={item.tone} />
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
