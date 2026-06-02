import type { HTMLAttributes } from "react";

type BadgeVariant = "success" | "warning" | "danger" | "info";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

function classes(...items: Array<string | false | undefined>) {
  return items.filter(Boolean).join(" ");
}

export function Badge({ variant = "info", className, ...props }: BadgeProps) {
  const base =
    "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold";

  const variantClass =
    variant === "success"
      ? "bg-emerald-100 text-emerald-800"
      : variant === "warning"
        ? "bg-amber-100 text-amber-800"
        : variant === "danger"
          ? "bg-red-100 text-red-800"
          : "bg-sky-100 text-sky-800";

  return <span className={classes(base, variantClass, className)} {...props} />;
}
