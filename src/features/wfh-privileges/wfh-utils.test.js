import test from "node:test";
import assert from "node:assert/strict";
import { balanceForEmployee, isWorkingWeekday, uniqueSortedDates, validateRequestedDates } from "./wfh-utils.js";

test("working-day rules reject weekends and non-working US/PH holidays", () => {
  const holidays = [{ holiday_date: "2026-12-25", is_working: false }, { holiday_date: "2026-12-24", is_working: true }];
  assert.equal(isWorkingWeekday("2026-12-21", holidays), true);
  assert.equal(isWorkingWeekday("2026-12-20", holidays), false);
  assert.equal(isWorkingWeekday("2026-12-25", holidays), false);
  assert.equal(isWorkingWeekday("2026-12-24", holidays), true);
});

test("date normalization sorts and removes duplicate dates", () => {
  assert.deepEqual(uniqueSortedDates(["2026-12-22", "2026-12-21", "2026-12-22", ""]), ["2026-12-21", "2026-12-22"]);
});

test("date validation enforces future weekdays, holidays, and 30-day cap", () => {
  const today = new Date("2026-12-18T12:00:00.000Z");
  assert.equal(validateRequestedDates(["2026-12-21"], [], today), "");
  assert.match(validateRequestedDates(["2026-12-18"], [], today), /after today/);
  assert.match(validateRequestedDates(["2026-12-20"], [], today), /weekdays/);
  assert.match(validateRequestedDates(["2026-12-21"], [{ holiday_date: "2026-12-21", is_working: false }], today), /weekdays/);
  assert.match(validateRequestedDates(Array.from({ length: 31 }, (_, index) => `2027-01-${String(index + 1).padStart(2, "0")}`), [], today), /30/);
});

test("available balance excludes expired, revoked, and other employees' rewards", () => {
  const today = new Date("2026-10-21T12:00:00.000Z");
  const rewards = [
    { employee_id: "e1", days_available: 2, expires_on: "2026-10-22", revoked_at: null },
    { employee_id: "e1", days_available: 5, expires_on: "2026-10-20", revoked_at: null },
    { employee_id: "e1", days_available: 4, expires_on: "2026-12-01", revoked_at: "2026-10-20" },
    { employee_id: "e2", days_available: 8, expires_on: "2026-12-01", revoked_at: null },
  ];
  assert.equal(balanceForEmployee(rewards, "e1", today), 2);
});
