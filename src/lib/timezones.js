// const FALLBACK_ZONES = ["UTC", "Asia/Manila", "America/New_York", "America/Los_Angeles", "Europe/London"];

// export const WORLD_TIME_ZONES = [...new Set(
//   typeof Intl.supportedValuesOf === "function" ? ["UTC", ...Intl.supportedValuesOf("timeZone")] : FALLBACK_ZONES,
// ) ].map((id) => ({
//   id,
//   label: `${id.replaceAll("_", " ").replaceAll("/", " / ")} · ${new Intl.DateTimeFormat(undefined, { timeZone: id, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value ?? "UTC"}`,
// }));

// const FALLBACK_ZONES = [
//   "Asia/Manila",
//   "America/New_York",
//   "America/Chicago",
//   "America/Denver",
//   "America/Phoenix",
//   "America/Los_Angeles",
//   "America/Anchorage",
//   "Pacific/Honolulu",
// ];


// const TIME_ZONES = [
//   // Philippines
//   { id: "Asia/Manila", standard: "PHT", daylight: null, country: "Philippines" },

//   // Eastern
//   { id: "America/New_York", standard: "EST", daylight: "EDT", country: "United States" },

//   // Central
//   { id: "America/Chicago", standard: "CST", daylight: "CDT", country: "United States" },

//   // Mountain
//   { id: "America/Denver", standard: "MST", daylight: "MDT", country: "United States" },

//   // Arizona (no DST, except Navajo Nation)
//   { id: "America/Phoenix", standard: "MST", daylight: null, country: "United States" },

//   // Pacific
//   { id: "America/Los_Angeles", standard: "PST", daylight: "PDT", country: "United States" },

//   // Alaska
//   { id: "America/Anchorage", standard: "AKST", daylight: "AKDT", country: "United States" },

//   // Hawaii
//   { id: "Pacific/Honolulu", standard: "HST", daylight: null, country: "United States" },

//   // Aleutian Islands
//   { id: "America/Adak", standard: "HST", daylight: "HDT", country: "United States" },

//   // Atlantic - Puerto Rico
//   { id: "America/Puerto_Rico", standard: "AST", daylight: null, country: "United States" },

//   // US Virgin Islands
//   { id: "America/St_Thomas", standard: "AST", daylight: null, country: "United States" },

//   // American Samoa
//   { id: "Pacific/Pago_Pago", standard: "SST", daylight: null, country: "United States" },

//   // Guam
//   { id: "Pacific/Guam", standard: "ChST", daylight: null, country: "United States" },

//   // Northern Mariana Islands
//   { id: "Pacific/Saipan", standard: "ChST", daylight: null, country: "United States" },

//   // Wake Island (US Minor Outlying Islands)
//   { id: "Pacific/Wake", standard: "WAKT", daylight: null, country: "United States" },
// ];


// export const WORLD_TIME_ZONES = TIME_ZONES.map(({ id, standard, daylight, country }) => {
//   const now = new Date();

//   const shortName = new Intl.DateTimeFormat("en-US", {
//     timeZone: id,
//     timeZoneName: "short",
//   })
//     .formatToParts(now)
//     .find((part) => part.type === "timeZoneName")?.value;

//   const offset = new Intl.DateTimeFormat("en-US", {
//     timeZone: id,
//     timeZoneName: "shortOffset",
//   })
//     .formatToParts(now)
//     .find((part) => part.type === "timeZoneName")?.value ?? "UTC";

//   // Use the actual current timezone abbreviation when available.
//   const abbreviation = daylight && shortName
//     ? shortName
//     : standard;

//   return {
//     id,
//     label: `${abbreviation} (${id}) · ${offset}`,
//     abbreviation,
//     standard,
//     daylight,
//     country,
//   };
// });

const API_URL = "https://hourora.app/api/v1/zones";

const COUNTRY_CODES = [
  "US",
  "PH",
  "PR",
  "VI",
  "GU",
  "MP",
  "AS",
  "UM",
];

const COUNTRY_NAMES = {
  US: "United States",
  PH: "Philippines",
  PR: "Puerto Rico",
  VI: "US Virgin Islands",
  GU: "Guam",
  MP: "Northern Mariana Islands",
  AS: "American Samoa",
  UM: "US Minor Outlying Islands",
};

// Fallback if the API is unavailable.
const FALLBACK_ZONES = [
  "Asia/Manila",
  "America/New_York",
  "America/Detroit",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "America/Adak",
  "Pacific/Honolulu",
  "America/Puerto_Rico",
  "America/St_Thomas",
  "Pacific/Pago_Pago",
  "Pacific/Guam",
  "Pacific/Saipan",
  "Pacific/Wake",
];

export function getTimeZoneInfo(id, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: id,
    timeZoneName: "short",
  }).formatToParts(date);

  const offsetParts = new Intl.DateTimeFormat("en-US", {
    timeZone: id,
    timeZoneName: "shortOffset",
  }).formatToParts(date);

  const abbreviation =
    parts.find((part) => part.type === "timeZoneName")?.value ?? "UTC";

  const offset =
    offsetParts.find((part) => part.type === "timeZoneName")?.value ?? "UTC";

  return {
    abbreviation,
    offset,
    label: `${abbreviation} (${id}) · ${offset}`,
  };
}

function createZone(id, countries = []) {
  const countryNames = countries
    .map((code) => COUNTRY_NAMES[code])
    .filter(Boolean);

  return {
    id,
    countries,
    country: countryNames.join(", "),
    ...getTimeZoneInfo(id),
  };
}

function getFallbackZones() {
  return FALLBACK_ZONES.map((id) =>
    createZone(id, id === "Asia/Manila" ? ["PH"] : ["US"])
  );
}

export async function fetchWorldTimeZones() {
  try {
    const zonesByCountry = await Promise.all(
      COUNTRY_CODES.map(async (country) => {
        const response = await fetch(
          `${API_URL}?country=${country}`
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch ${country} timezones`);
        }

        const data = await response.json();
        return data.zones ?? [];
      })
    );

    const zones = zonesByCountry.flat();

    if (!zones.length) {
      throw new Error("No timezone data received");
    }

    const uniqueZones = new Map();

    zones.forEach((zone) => {
      if (!uniqueZones.has(zone.id)) {
        uniqueZones.set(
          zone.id,
          createZone(zone.id, zone.countries ?? [])
        );
      }
    });

    return [...uniqueZones.values()].sort((a, b) => {
      if (a.id === "Asia/Manila") return -1;
      if (b.id === "Asia/Manila") return 1;
      return a.id.localeCompare(b.id);
    });

  } catch (error) {
    console.error("Timezone API error:", error);
    return getFallbackZones();
  }
}
