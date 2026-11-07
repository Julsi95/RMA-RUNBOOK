import test from "node:test";
import assert from "node:assert/strict";
import { KPI_METRICS } from "./kpi-data.js";
import { readKpiFile } from "./import-utils.js";

function makeCsv(delimiter, { noisyHeaders = false } = {}) {
  const group = ["2026/FEBRUARY"];
  const subheader = ["NAME"];
  const values = ["Sample Agent"];
  for (const metric of KPI_METRICS) {
    group.push(metric.label, "", "");
    subheader.push("Score", "Equivalent Score", "Weighted Score");
    values.push("98%", "4.8", "0.72");
  }
  group.push("KPI", "TEAM SCORE:", "");
  subheader.push("SCORE", noisyHeaders ? "\u00a0EVALUATION\u00a0" : "EVALUATION", "RANK\u00a0");
  values.push("4.82", "Outstanding", "1st");
  const rows = [["Monthly results"], group, subheader, values];
  return rows.map((row) => row.map((value) => {
    const text = String(value);
    return text.includes(delimiter) || text.includes('"') ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(delimiter)).join("\r\n");
}

async function parseCsv(text) {
  const file = new Blob([text], { type: "text/csv" });
  Object.defineProperty(file, "name", { value: "synthetic-kpi.csv" });
  return readKpiFile(file, []);
}

test("reads Evaluation and Rank from merged summary headers in a semicolon CSV", async () => {
  const parsed = await parseCsv(`\uFEFF${makeCsv(";", { noisyHeaders: true })}`);
  const row = parsed.tables[0].imported[0];

  assert.equal(row.evaluation, "Outstanding");
  assert.equal(row.importedRank, "1st");
  assert.equal(parsed.tables[0].missingColumns.includes("Evaluation"), false);
  assert.equal(parsed.tables[0].missingColumns.includes("Rank"), false);
});

test("reads Evaluation and Rank from comma-delimited synthetic CSV", async () => {
  const parsed = await parseCsv(makeCsv(","));
  assert.equal(parsed.tables[0].imported[0].evaluation, "Outstanding");
  assert.equal(parsed.tables[0].imported[0].importedRank, "1st");
});
