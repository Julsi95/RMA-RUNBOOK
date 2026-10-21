import test from "node:test";
import assert from "node:assert/strict";
import { canShowBirthday, getNextBirthday } from "./birthday-calendar.js";

const now = new Date(2026, 9, 21, 12);

test("private birthdays are shown only within the next 14 days", () => {
  assert.equal(canShowBirthday({ birthday: "1990-11-04", isPublic: false, canManage: false, now }), true);
  assert.equal(canShowBirthday({ birthday: "1990-11-05", isPublic: false, canManage: false, now }), false);
});

test("public birthdays remain visible and admins can see private birthdays", () => {
  assert.equal(canShowBirthday({ birthday: "1990-12-25", isPublic: true, canManage: false, now }), true);
  assert.equal(canShowBirthday({ birthday: "1990-12-25", isPublic: false, canManage: true, now }), true);
});

test("next birthday calculation rolls into the next year without exposing the birth year", () => {
  const result = getNextBirthday("1990-01-03", now);
  assert.equal(result.date.getFullYear(), 2027);
  assert.equal(result.days, 74);
  assert.equal(getNextBirthday("not-a-date", now), null);
});
