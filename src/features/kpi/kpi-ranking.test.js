import test from "node:test";
import assert from "node:assert/strict";
import { getConsecutiveTopThreeStreak } from "./kpi-ranking.js";

const score = (record) => Number(record.score) || 0;
const month = (records) => ({ records });

test("counts consecutive months ranked in the top three", () => {
  const history = {
    "2026-03": month({ jul: { score: 3.6 }, a: { score: 5 }, b: { score: 4 }, c: { score: 3.5 } }),
    "2026-04": month({ jul: { score: 5 }, a: { score: 4 }, b: { score: 3 }, c: { score: 2 } }),
    "2026-05": month({ jul: { score: 4 }, a: { score: 5 }, b: { score: 3 }, c: { score: 2 } }),
  };

  assert.equal(getConsecutiveTopThreeStreak(history, "jul", "2026-05", score), 3);
});

test("stops counting when the member falls outside the top three", () => {
  const history = {
    "2026-03": month({ jul: { score: 1 }, a: { score: 5 }, b: { score: 4 }, c: { score: 3 } }),
    "2026-04": month({ jul: { score: 2 }, a: { score: 5 }, b: { score: 4 }, c: { score: 3 } }),
    "2026-05": month({ jul: { score: 3.6 }, a: { score: 5 }, b: { score: 4 }, c: { score: 3.5 } }),
  };

  assert.equal(getConsecutiveTopThreeStreak(history, "jul", "2026-05", score), 1);
});

test("uses explicit imported rank instead of its position in the sorted list", () => {
  const history = {
    "2026-04": month({ jul: { source: "import", metrics: { _importedRank: "#5" }, score: 5 } }),
    "2026-05": month({ jul: { source: "import", metrics: { _importedRank: "#2" }, score: 1 } }),
  };

  assert.equal(getConsecutiveTopThreeStreak(history, "jul", "2026-05", score), 1);
});

test("stops at a missing calendar month and caps the streak at 12 months", () => {
  const history = {
    "2026-03": month({ jul: { score: 5 } }),
    "2026-05": month({ jul: { score: 5 } }),
  };
  const twelveMonths = Object.fromEntries(Array.from({ length: 14 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 4 - index, 1));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    return [key, month({ jul: { score: 5 } })];
  }));

  assert.equal(getConsecutiveTopThreeStreak(history, "jul", "2026-05", score), 1);
  assert.equal(getConsecutiveTopThreeStreak(twelveMonths, "jul", "2026-05", score), 12);
});
