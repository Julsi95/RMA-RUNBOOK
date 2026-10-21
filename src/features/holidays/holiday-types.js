export const HOLIDAY_COUNTRIES = Object.freeze({ US: "United States", PH: "Philippines" });
export const HOLIDAY_WORK_STATUS = Object.freeze({ WORKING: "working", NON_WORKING: "non-working" });

/** @typedef {"US" | "PH"} HolidayCountry */
/** @typedef {{ id: string, country_code: HolidayCountry, holiday_date: string, name: string, name_override: string | null, is_working: boolean }} HolidayRecord */
