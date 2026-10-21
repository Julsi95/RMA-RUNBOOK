import test from "node:test";
import assert from "node:assert/strict";
import { mapHolidayProviderEntries } from "./holiday-mapping.js";

test("holiday sync includes nationwide dates and classifies Public holidays as non-working", () => {
  const entries = mapHolidayProviderEntries([
    { date: "2026-12-25", localName: "Christmas Day", global: true, types: ["Public"] },
    { date: "2026-12-26", name: "Boxing Day", global: true, types: ["Bank"] },
    { date: "2026-12-24", name: "Regional holiday", global: false, types: ["Public"] },
  ], "PH");
  assert.deepEqual(entries.map(({ holiday_date, is_working }) => [holiday_date, is_working]), [["2026-12-25", false], ["2026-12-26", true]]);
});

test("sync identity stays stable if a provider changes a holiday display name", () => {
  const oldEntry = mapHolidayProviderEntries([{ date: "2026-12-25", name: "Christmas Day", global: true, types: ["Public"] }], "US")[0];
  const updatedEntry = mapHolidayProviderEntries([{ date: "2026-12-25", name: "Christmas", global: true, types: ["Public"] }], "US")[0];
  assert.equal(oldEntry.source_key, updatedEntry.source_key);
});

test("duplicate provider rows do not create duplicate calendar entries", () => {
  const entries = mapHolidayProviderEntries([
    { date: "2026-11-27", localName: "Holiday", global: true, types: ["Public"] },
    { date: "2026-11-27", localName: " Holiday ", global: true, types: ["Public"] },
    { date: "invalid", localName: "bad", global: true, types: [] },
  ], "US");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].source_key, "US:2026-11-27:0");
});
