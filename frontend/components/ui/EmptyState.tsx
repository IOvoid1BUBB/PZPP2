/**
 * @file EmptyState.tsx
 * Reusable empty-state panel (UX-03): icon + title + description + optional CTA.
 * No view should ever render a blank white panel without context.
 */
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Optional call-to-action rendered below the description. */
  action?: ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  "data-testid": testId = "empty-state",
}: EmptyStateProps) {
  return (
    <div
      data-testid={testId}
      role="status"
      className={[
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-ui-border/60 bg-ui-surface px-6 py-10 text-center",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-ui-raised text-ui-secondary">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <h3 className="text-sm font-semibold text-ui-primary">{title}</h3>
      {description ? (
        <p className="max-w-xs text-pretty text-xs text-ui-secondary">{description}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
