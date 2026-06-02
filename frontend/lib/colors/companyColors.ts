const COMPANY_COLOR_COUNT = 12;

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
