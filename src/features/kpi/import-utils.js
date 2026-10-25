import * as XLSX from "xlsx";
import { KPI_METRICS, emptyMetrics } from "@/features/kpi/kpi-data";

const MAX_KPI_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_KPI_IMPORT_SHEETS = 20;
const MAX_KPI_IMPORT_CELLS = 250_000;
const MAX_KPI_IMPORT_ROWS = 2_000;
const MAX_KPI_IMPORT_COLUMNS = 100;

const normalize = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
function historicalMemberId(identity) {
  const value = normalize(identity);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `historical:${(hash >>> 0).toString(36)}`;
}
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
  const roleKey = headers.find((header) => ["role", "position", "jobtitle", "title"].includes(normalize(header)));
  const identityKey = headers.find((header) => ["employeeid", "agentid", "personnelid", "staffid", "employee number", "employeenumber"].includes(normalize(header)));
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
    const historicalIdentity = String(identityKey ? row[identityKey] ?? "" : "").trim() || name;
    const memberId = member?.id ?? historicalMemberId(historicalIdentity);
    const role = member?.role ?? String(roleKey ? row[roleKey] ?? "" : "").trim();
    if (!member) unmatched.push(name);
    if (seen.has(memberId)) repeated.push(name);
    seen.add(memberId);
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
      memberId,
      memberName: member?.name ?? name,
      role,
      historical: !member,
      metrics,
      overallScore: overallHeader ? numericValue(row[overallHeader]) : null,
      evaluation: evaluationHeader ? String(row[evaluationHeader] ?? "").trim() : "",
      importedRank: rankHeader ? String(row[rankHeader] ?? "").trim() : "",
    });
  }
  return { imported, unmatched: [...new Set(unmatched)], repeated: [...new Set(repeated)], missingColumns };
}

export async function readKpiFile(file, teamMembers) {
  if (!file || file.size <= 0) throw new Error("Choose a non-empty CSV or Excel file.");
  if (file.size > MAX_KPI_IMPORT_BYTES) throw new Error("KPI import files must be 10 MB or smaller.");
  const extension = String(file.name ?? "").toLowerCase().match(/\.(csv|xlsx|xls)$/)?.[1];
  if (!extension) throw new Error("Use a CSV, XLSX, or XLS file.");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: false,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    bookVBA: false,
    sheetRows: MAX_KPI_IMPORT_ROWS + 1,
  });
  if (workbook.SheetNames.length > MAX_KPI_IMPORT_SHEETS) throw new Error(`A workbook can contain up to ${MAX_KPI_IMPORT_SHEETS} sheets.`);
  const tables = [];
  let inspectedCells = 0;
  let importedRows = 0;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const range = sheet?.["!fullref"] || sheet?.["!ref"];
    if (!range) continue;
    const bounds = XLSX.utils.decode_range(range);
    const rowCount = bounds.e.r - bounds.s.r + 1;
    const columnCount = bounds.e.c - bounds.s.c + 1;
    if (rowCount > MAX_KPI_IMPORT_ROWS || columnCount > MAX_KPI_IMPORT_COLUMNS) {
      throw new Error(`Each sheet must contain at most ${MAX_KPI_IMPORT_ROWS} rows and ${MAX_KPI_IMPORT_COLUMNS} columns.`);
    }
    inspectedCells += rowCount * columnCount;
    if (inspectedCells > MAX_KPI_IMPORT_CELLS) {
      throw new Error("This workbook has too many cells to import safely.");
    }
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, blankrows: false });
    for (const { month, objects } of rowsToTables(rows)) {
      const normalized = normalizeImportedRows(objects, teamMembers);
      importedRows += normalized.imported.length;
      if (importedRows > MAX_KPI_IMPORT_ROWS) throw new Error(`An import can contain up to ${MAX_KPI_IMPORT_ROWS} result rows.`);
      tables.push({ month: month ?? getMonthFromLabel(`${file.name} ${sheetName}`), ...normalized });
      if (tables.length > MAX_KPI_IMPORT_SHEETS) throw new Error(`An import can contain up to ${MAX_KPI_IMPORT_SHEETS} monthly tables.`);
    }
  }
  if (!tables.length) throw new Error("Could not find a usable data table. Use the provided CSV template or a spreadsheet with a Name column and KPI columns.");
  return { tables, fileName: file.name };
}
