const COMPANY_COLOR_COUNT = 12;

/** Hard HEX palettes for SVG/Recharts (must match globals.css company tokens). */
const COMPANY_COLORS_LIGHT = [
  "#0066b3",
  "#aa6e00",
  "#0c7338",
  "#3131d4",
  "#c71a3a",
  "#8546c7",
  "#b55d00",
  "#406e80",
  "#007a70",
  "#9300c9",
  "#334155",
  "#1e293b",
] as const;

const COMPANY_COLORS_DARK = [
  "#7cc4ff",
  "#ffd470",
  "#75d9a4",
  "#9cabff",
  "#ff8ca3",
  "#bf9dff",
  "#ffc079",
  "#8dc5d5",
  "#59d8cb",
  "#ee9dff",
  "#d2d9e6",
  "#e2e8f0",
] as const;

export interface CompanyColorPair {
  intense: string;
  muted: string;
}

function hashKey(input: string): number {
  if (!input) {
    return 0;
  }

  return input.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

export function getCompanyColorIndex(key: string): number {
  return (hashKey(key) % COMPANY_COLOR_COUNT) + 1;
}

export function getCompanyColorPair(key: string): CompanyColorPair {
  const index = getCompanyColorIndex(key);
  return {
    intense: `var(--ui-company-${index}-intense)`,
    muted: `var(--ui-company-${index}-muted)`,
  };
}

/** Same index mapping as TrailerCanvas, with fixed HEX for Recharts SVG fills. */
export function getCompanyColorHex(key: string, isDark = false): string {
  const index = getCompanyColorIndex(key) - 1;
  const palette = isDark ? COMPANY_COLORS_DARK : COMPANY_COLORS_LIGHT;
  return palette[index] ?? palette[0];
}
