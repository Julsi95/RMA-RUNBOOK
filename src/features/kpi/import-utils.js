import * as XLSX from "xlsx";
import { KPI_METRICS, emptyMetrics } from "@/features/kpi/kpi-data";

const normalize = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
const shortNameKey = (value) => {
  const parts = String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0][0]}${parts.at(-1)}` : "";
};

function findHeaderRows(rows) {
  return rows.map((row, index) => ({ row, index })).filter(({ row, index }) => {
    const text = row.map(normalize).join(" ");
    const following = (rows[index + 1] ?? []).map(normalize).join(" ");
    return text.includes("qascore") && (text.includes("callshandled") || text.includes("completioncount")) && following.includes("equivalent") && following.includes("weighted");
  }).map(({ index }) => index);
}

function getMonthFromLabel(text) {
  const names = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
  const monthName = "JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?";
  const match = text.match(new RegExp(`(20\\d{2})\\s*[-/]\\s*(\\d{1,2}|${monthName})`, "i"))
    ?? text.match(new RegExp(`(${monthName})\\s*[-/, ]\\s*(20\\d{2})`, "i"));
  if (!match) return null;
  const yearFirst = /^20\d{2}$/.test(match[1]);
  const yearText = yearFirst ? match[1] : match[2];
  const monthText = (yearFirst ? match[2] : match[1]).toUpperCase().slice(0, 3);
  const month = names[monthText] ?? String(Number(monthText)).padStart(2, "0");
  return `${yearText}-${month}`;
}

function getMonthFromRows(rows, headerIndex) {
  const text = rows.slice(Math.max(0, headerIndex - 3), headerIndex + 1).flat().map((cell) => String(cell ?? "")).join(" ");
  return getMonthFromLabel(text);
}

function tableRowsToObjects(rows, headerIndex, nextHeaderIndex) {
  if (headerIndex >= 0) {
    const groupRow = rows[headerIndex] ?? [];
    const subheaderRow = rows[headerIndex + 1] ?? [];
    let currentGroup = "";
    const headers = groupRow.map((cell, index) => {
      const group = String(cell ?? "").trim();
      if (group) currentGroup = group;
      const subheader = String(subheaderRow[index] ?? "").trim();
      if (currentGroup && KPI_METRICS.some((metric) => normalize(currentGroup).includes(normalize(metric.label)))) {
        return `${currentGroup} ${subheader}`.trim();
      }
      if (normalize(currentGroup).includes("kpi")) return `KPI ${subheader}`.trim();
      return group || subheader || `Column ${index + 1}`;
    });
    const endIndex = nextHeaderIndex ?? rows.length;
    const objects = rows.slice(headerIndex + 2, endIndex).filter((row) => row.some((cell) => String(cell ?? "").trim())).map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
    );
    return objects;
  }
  return [];
}

function rowsToTables(rows) {
  const headerIndexes = findHeaderRows(rows);
  if (headerIndexes.length) {
    return headerIndexes.map((headerIndex, tableIndex) => {
      const objects = tableRowsToObjects(rows, headerIndex, headerIndexes[tableIndex + 1]);
      return { month: getMonthFromRows(rows, headerIndex), objects };
    });
  }
  const headerRowIndex = rows.findIndex((row) => row.some((cell) => ["name", "agent", "employee", "team member"].includes(normalize(cell))));
  if (headerRowIndex < 0) return [];
  const headers = rows[headerRowIndex].map((cell) => String(cell ?? "").trim());
  return [{ month: null, objects: rows.slice(headerRowIndex + 1).filter((row) => row.some((cell) => String(cell ?? "").trim())).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))) }];
}

function numericValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  const raw = String(value ?? "").replace(/,/g, "").replace(/%/g, "").trim();
  if (!raw) return "";
  const number = Number(raw);
  return Number.isFinite(number) ? number : "";
}

function findNameColumn(rows, teamMembers) {
  const headers = Object.keys(rows[0] ?? {});
  const explicit = headers.find((key) => ["name", "agent", "employee", "teammember", "person", "employeename", "agentname"].includes(normalize(key)));
  if (explicit) return explicit;
  const knownNames = new Set(teamMembers.map((member) => normalize(member.name)));
  const knownShortNames = new Set(teamMembers.map((member) => shortNameKey(member.name)).filter(Boolean));
  const scores = headers.map((header) => ({
    header,
    score: rows.reduce((count, row) => {
      const value = String(row[header] ?? "").trim();
      return count + (knownNames.has(normalize(value)) || knownShortNames.has(shortNameKey(value)) ? 1 : 0);
    }, 0),
  })).sort((a, b) => b.score - a.score);
  if (scores[0]?.score > 0) return scores[0].header;
  return headers.find((header) => rows.some((row) => {
    const value = String(row[header] ?? "").trim();
    return value && !Number.isFinite(Number(value));
  })) ?? headers[0];
}

function findMetricCell(row, metric, kind) {
  const entries = Object.entries(row);
  const metricNames = [normalize(metric.label), normalize(metric.shortLabel)];
  const key = entries.find(([header]) => {
    const normalized = normalize(header);
    const includesMetric = metricNames.some((name) => normalized.includes(name));
    if (!includesMetric) return false;
    if (kind === "weighted") return normalized.includes("weighted");
    if (kind === "equivalent") return normalized.includes("equivalent") || normalized.includes("equiv");
    return !normalized.includes("weighted") && !normalized.includes("equivalent") && !normalized.includes("equiv");
  });
  if (key) return key[1];
  if (metric.id === "qa" && kind === "value") {
    const fallback = entries.find(([header]) => ["score", "qascore", "percentage", "qapercent"].includes(normalize(header)));
    return fallback?.[1] ?? "";
  }
  return "";
}

export function normalizeImportedRows(rows, teamMembers) {
  const headers = Object.keys(rows[0] ?? {});
  const missingColumns = [];
  for (const metric of KPI_METRICS) {
    const aliases = [normalize(metric.label), normalize(metric.shortLabel)];
    const hasMetric = headers.some((header) => aliases.some((alias) => normalize(header).includes(alias)));
    if (!hasMetric) {
      missingColumns.push(`${metric.label} values`);
      continue;
    }
    if (!headers.some((header) => aliases.some((alias) => normalize(header).includes(alias)) && (normalize(header).includes("equivalent") || normalize(header).includes("equiv")))) missingColumns.push(`${metric.label} equivalent score`);
    if (!headers.some((header) => aliases.some((alias) => normalize(header).includes(alias)) && normalize(header).includes("weighted"))) missingColumns.push(`${metric.label} weighted score`);
  }
  const nameKey = findNameColumn(rows, teamMembers);
  const memberByName = new Map(teamMembers.map((member) => [normalize(member.name), member]));
  const membersByShortName = new Map();
  for (const member of teamMembers) {
    const key = shortNameKey(member.name);
    if (!key) continue;
    membersByShortName.set(key, [...(membersByShortName.get(key) ?? []), member]);
  }
  const imported = [];
  const unmatched = [];
  const repeated = [];
  const seen = new Set();

  const rankHeader = Object.keys(rows[0] ?? {}).find((header) => normalize(header) === "rank" || normalize(header).endsWith("rank"));
  for (const [rowIndex, row] of rows.entries()) {
    const name = String(row[nameKey] ?? "").trim();
    if (!name || ["name", "agent", "employee"].includes(normalize(name))) continue;
    const exactMatch = memberByName.get(normalize(name));
    const shortMatches = membersByShortName.get(shortNameKey(name)) ?? [];
    const member = exactMatch ?? (shortMatches.length === 1 ? shortMatches[0] : null);
    if (!member) unmatched.push(name);
    if (member && seen.has(member.id)) repeated.push(name);
    if (member) seen.add(member.id);
    const metrics = emptyMetrics();
    for (const metric of KPI_METRICS) {
      const rawValue = numericValue(findMetricCell(row, metric, "value"));
      const equivalentScore = numericValue(findMetricCell(row, metric, "equivalent"));
      const weightedScore = numericValue(findMetricCell(row, metric, "weighted"));
      metrics[metric.id] = {
        rawValue,
        equivalentScore,
        weightedScore,
        percentValue: metric.isPercent && rawValue !== "" ? rawValue : null,
      };
    }
    const overallHeader = Object.keys(row).find((header) => normalize(header).includes("kpiscore"));
    const evaluationHeader = Object.keys(row).find((header) => normalize(header).includes("evaluation"));
    imported.push({
      importRowId: `${rowIndex}-${normalize(name)}`,
      sourceName: name,
      memberId: member?.id ?? "",
      memberName: member?.name ?? name,
      role: member?.role ?? "",
      metrics,
      overallScore: overallHeader ? numericValue(row[overallHeader]) : null,
      evaluation: evaluationHeader ? String(row[evaluationHeader] ?? "").trim() : "",
      importedRank: rankHeader ? String(row[rankHeader] ?? "").trim() : "",
    });
  }
  return { imported, unmatched: [...new Set(unmatched)], repeated: [...new Set(repeated)], missingColumns };
}

export async function readKpiFile(file, teamMembers) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const tables = workbook.SheetNames.flatMap((sheetName) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false });
    return rowsToTables(rows).map(({ month, objects }) => ({ month: month ?? getMonthFromLabel(`${file.name} ${sheetName}`), ...normalizeImportedRows(objects, teamMembers) }));
  });
  if (!tables.length) throw new Error("Could not find a usable data table. Use the provided CSV template or a spreadsheet with a Name column and KPI columns.");
  return { tables, fileName: file.name };
}
