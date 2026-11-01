const COUNTRY_NAMES: Record<string, string> = {
  IN: "India",
  US: "United States",
  GB: "United Kingdom",
  DE: "Germany",
  SG: "Singapore",
  AE: "United Arab Emirates",
  AU: "Australia",
  CA: "Canada"
};

export function countryName(code?: string): string {
  const value = (code || "").trim();
  if (!value) return "";
  return COUNTRY_NAMES[value.toUpperCase()] || value;
}

export function placeLabel(country?: string, city?: string): string {
  return [city?.trim(), countryName(country)].filter(Boolean).join(", ");
}
