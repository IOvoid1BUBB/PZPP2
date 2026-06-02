type ProgressTone = "green" | "amber" | "red";

interface ProgressBarProps {
  value: number;
  max?: number;
  tone?: ProgressTone;
  label?: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function ProgressBar({
  value,
  max = 100,
  tone = "green",
  label,
}: ProgressBarProps) {
  const percent = clamp((value / max) * 100, 0, 100);
  const fillClass =
    tone === "green"
      ? "bg-emerald-500"
      : tone === "amber"
        ? "bg-amber-500"
        : "bg-red-500";

  return (
    <div className="w-full">
      {label ? (
        <div className="mb-1 text-xs text-[var(--ui-text-secondary)]">
          {label}
        </div>
      ) : null}
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--ui-accent-muted)]">
        <div
          className={`${fillClass} h-full transition-[width] duration-300`}
          style={{ width: `${percent}%` }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={Math.round(clamp(value, 0, max))}
        />
      </div>
    </div>
  );
}
