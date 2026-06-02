import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

function classes(...items: Array<string | false | undefined>) {
  return items.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

  const variantClass =
    variant === "primary"
      ? "bg-[var(--ui-accent)] text-white hover:bg-[color-mix(in_srgb,var(--ui-accent)_85%,black)] focus-visible:outline-[var(--ui-accent)]"
      : variant === "secondary"
        ? "border border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-raised)] focus-visible:outline-[var(--ui-border-strong)]"
        : variant === "danger"
          ? "bg-[var(--ui-danger)] text-white hover:bg-[color-mix(in_srgb,var(--ui-danger)_86%,black)] focus-visible:outline-[var(--ui-danger)]"
          : "bg-transparent text-[var(--ui-text-secondary)] hover:bg-[var(--ui-surface-raised)] focus-visible:outline-[var(--ui-border-strong)]";

  return (
    <button
      type={type}
      className={classes(base, variantClass, className)}
      {...props}
    />
  );
}
