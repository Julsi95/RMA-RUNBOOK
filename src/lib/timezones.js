const FALLBACK_ZONES = ["UTC", "Asia/Manila", "America/New_York", "America/Los_Angeles", "Europe/London"];

export const WORLD_TIME_ZONES = [...new Set(
  typeof Intl.supportedValuesOf === "function" ? ["UTC", ...Intl.supportedValuesOf("timeZone")] : FALLBACK_ZONES,
) ].map((id) => ({
  id,
  label: `${id.replaceAll("_", " ").replaceAll("/", " / ")} · ${new Intl.DateTimeFormat(undefined, { timeZone: id, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value ?? "UTC"}`,
}));
