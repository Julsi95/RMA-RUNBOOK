export function mapHolidayProviderEntries(payload, country) {
  if (!Array.isArray(payload) || !["US", "PH"].includes(country)) return [];
  const ordinals = new Map();
  const seen = new Set();
  const entries = [];
  for (const item of payload) {
    if (!item || item.global !== true || !/^\d{4}-\d{2}-\d{2}$/.test(item.date ?? "")) continue;
    const name = String(item.localName || item.name || "").trim();
    if (!name || name.length > 160) continue;
    const displayKey = `${item.date}:${name.toLocaleLowerCase()}`;
    if (seen.has(displayKey)) continue;
    seen.add(displayKey);
    const ordinal = ordinals.get(item.date) ?? 0;
    ordinals.set(item.date, ordinal + 1);
    entries.push({
      holiday_date: item.date,
      name,
      source_key: `${country}:${item.date}:${ordinal}`,
      is_working: !(Array.isArray(item.types) && item.types.includes("Public")),
    });
  }
  return entries;
}
