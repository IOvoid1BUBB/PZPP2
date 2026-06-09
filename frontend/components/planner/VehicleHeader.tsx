interface VehicleMetric {
  label: string;
  value: string;
  hint?: string;
}

interface VehicleHeaderProps {
  name: string;
  driverName?: string;
  itemsCount: number;
  usedWeightKg: number;
  maxWeightKg: number;
  usedLdm: number;
  maxLdm: number;
  profitEur?: number;
  saving?: boolean;
  onSave?: () => void;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "0%";
  }
  return `${Math.round(value)}%`;
}

export function VehicleHeader({
  name,
  driverName = "—",
  itemsCount,
  usedWeightKg,
  maxWeightKg,
  usedLdm,
  maxLdm,
  profitEur,
  saving,
  onSave,
}: VehicleHeaderProps) {
  const lfilPercent = maxLdm > 0 ? (usedLdm / maxLdm) * 100 : 0;

  const metrics: VehicleMetric[] = [
    { label: "Vehicle", value: name },
    { label: "Driver", value: driverName },
    { label: "Items", value: String(itemsCount) },
    {
      label: "Weight",
      value: `${Math.round(usedWeightKg)} / ${maxWeightKg}kg`,
    },
    {
      label: "Profit",
      value: profitEur != null ? `${profitEur} EUR` : "—",
    },
  ];

  return (
    <header className="vehicle-header vehicle-header--metrics">
      <div className="vehicle-header__metrics" role="group" aria-label="Statystyki pojazdu">
        {metrics.map((metric) => (
          <div key={metric.label} className="vehicle-header__metric">
            <span className="vehicle-header__metric-label">{metric.label}</span>
            <span className="vehicle-header__metric-value">{metric.value}</span>
          </div>
        ))}
        <div className="vehicle-header__metric vehicle-header__metric--lfil">
          <span className="vehicle-header__metric-label">LFIL</span>
          <span className="vehicle-header__metric-value vehicle-header__metric-value--accent">
            {formatPercent(lfilPercent)}
          </span>
          <div
            className="vehicle-header__lfil-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(lfilPercent)}
            aria-label="Load factor"
          >
            <div
              className="vehicle-header__lfil-fill"
              style={{ width: `${Math.min(100, lfilPercent)}%` }}
            />
          </div>
        </div>
      </div>
      <button
        type="button"
        className="button button--primary vehicle-header__send"
        onClick={onSave}
        disabled={saving || !onSave}
      >
        {saving ? "Wysyłanie…" : "Send to driver"}
        <span aria-hidden="true" className="vehicle-header__send-arrow">
          ›
        </span>
      </button>
    </header>
  );
}
