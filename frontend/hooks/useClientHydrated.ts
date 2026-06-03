"use client";

import { useEffect, useState } from "react";

/**
 * Returns false during SSR and the first client render, then true after mount.
 * Use before reading sessionStorage-backed Zustand state to avoid hydration mismatches.
 */
export function useClientHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return hydrated;
}
