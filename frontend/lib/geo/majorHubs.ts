/**
 * @file majorHubs.ts
 * Static lookup for major European logistics hub cities.
 * Key: `"${Math.round(lat * 2) / 2}_${Math.round(lon * 2) / 2}"` (0.5° grid buckets)
 * Used to resolve human-readable city names from approximate coordinates
 * without any external API call.
 */

/** Lookup: "{lat_bucket}_{lon_bucket}" → city name */
export const MAJOR_HUBS: Record<string, string> = {
  // Poland
  "52.0_21.0": "Warszawa",
  "51.5_19.5": "Łódź",
  "51.0_17.0": "Wrocław",
  "52.5_17.0": "Poznań",
  "50.5_19.0": "Katowice",
  "54.5_18.5": "Gdańsk",
  "50.0_20.0": "Kraków",
  "53.0_18.0": "Bydgoszcz",
  "53.5_14.5": "Szczecin",
  "51.0_22.5": "Lublin",
  // Germany
  "52.5_13.5": "Berlin",
  "53.5_10.0": "Hamburg",
  "48.0_11.5": "München",
  "51.0_6.5": "Köln",
  "50.0_8.5": "Frankfurt",
  "51.5_7.0": "Dortmund",
  "48.5_9.0": "Stuttgart",
  "51.5_7.5": "Düsseldorf",
  "53.0_9.0": "Bremen",
  "47.5_9.5": "Konstanz",
  // Czech Republic
  "50.0_14.5": "Praha",
  "49.0_16.5": "Brno",
  // Austria
  "48.0_16.5": "Wien",
  "47.5_13.0": "Salzburg",
  "47.0_15.5": "Graz",
  // Netherlands
  "52.5_4.5": "Amsterdam",
  "52.0_4.5": "Rotterdam",
  "52.0_4.0": "Den Haag",
  "51.5_5.0": "Eindhoven",
  // Belgium
  "51.0_4.5": "Antwerpen",
  "50.5_4.5": "Bruxelles",
  // France
  "49.0_2.5": "Paris",
  "45.5_4.5": "Lyon",
  "43.5_5.5": "Marseille",
  "43.5_1.5": "Toulouse",
  "47.5_7.5": "Strasbourg",
  "50.5_3.0": "Lille",
  "47.0_0.5": "Tours",
  // Hungary
  "47.5_19.0": "Budapest",
  // Slovakia
  "48.0_17.0": "Bratislava",
  // Romania
  "44.5_26.0": "Bucuresti",
  "46.5_23.5": "Cluj-Napoca",
  // Sweden
  "59.5_18.0": "Stockholm",
  "57.5_12.0": "Göteborg",
  "55.5_13.0": "Malmö",
  // Denmark
  "55.5_12.5": "København",
  "57.0_10.0": "Aalborg",
  // Switzerland
  "47.5_8.5": "Zürich",
  "46.0_6.5": "Genève",
  // Italy
  "45.5_9.0": "Milano",
  "44.5_11.0": "Bologna",
  "41.5_12.5": "Roma",
  // Spain
  "40.5_-3.5": "Madrid",
  "41.5_2.0": "Barcelona",
  "37.5_-6.0": "Sevilla",
  // UK
  "51.5_-0.0": "London",
  "53.5_-2.5": "Manchester",
  "52.5_-1.5": "Birmingham",
};

/**
 * Resolve a human-readable city name from WGS84 coordinates.
 * Returns null when no known hub is close enough.
 */
export function lookupCityName(lat: number, lon: number): string | null {
  const latBucket = Math.round(lat * 2) / 2;
  const lonBucket = Math.round(lon * 2) / 2;
  const key = `${latBucket}_${lonBucket}`;
  return MAJOR_HUBS[key] ?? null;
}

/**
 * Resolve a human-readable label from coordinates.
 * Falls back to "Reg. {lat}°N, {lon}°E" if no hub matches.
 */
export function coordToLabel(lat: number, lon: number): string {
  return lookupCityName(lat, lon) ?? `Reg. ${Math.round(lat)}°N, ${Math.round(lon)}°E`;
}
