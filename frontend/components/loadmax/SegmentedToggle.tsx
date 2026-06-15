"use client";

import { cn } from "@/lib/utils";

export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-fit items-center gap-1 rounded-full bg-ui-nav p-1",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={cn(
            "rounded-full px-5 py-1.5 text-sm font-medium transition-colors",
            value === option
              ? "bg-[#373a4a] text-white"
              : "text-ui-secondary hover:text-ui-primary",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
