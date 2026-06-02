import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

function classes(...items: Array<string | false | undefined>) {
  return items.filter(Boolean).join(" ");
}

export function Card({ children, className, ...props }: CardProps) {
  return (
    <div
      className={classes(
        "rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 shadow-sm",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2 text-base font-semibold text-[var(--ui-text-primary)]">
      {children}
    </h2>
  );
}

export function CardDescription({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[var(--ui-text-secondary)]">{children}</p>;
}
