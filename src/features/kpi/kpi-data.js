import { getOrganizationMembers, ORGANIZATION_STORAGE_KEY } from "@/features/organization/organization-data";

export const KPI_STORAGE_KEY = "starter-app-monthly-kpi-v1";
export const TEAM_STORAGE_KEY = ORGANIZATION_STORAGE_KEY;
export const KPI_SCORING_SETTINGS_KEY = "starter-app-kpi-scoring-settings-v1";

export const KPI_METRICS = [
  { id: "qa", label: "QA score", shortLabel: "QA", valueLabel: "Score (%)", weight: 0.15, isPercent: true },
  { id: "callsHandled", label: "Calls handled", shortLabel: "Calls", valueLabel: "Count", weight: 0.2 },
  { id: "completionCount", label: "Completion count", shortLabel: "Completion", valueLabel: "Count", weight: 0.48 },
  { id: "error", label: "Error", shortLabel: "Error", valueLabel: "Count", weight: 0.02 },
  { id: "kudos", label: "Kudos", shortLabel: "Kudos", valueLabel: "Count", weight: 0 },
  { id: "absenteeism", label: "Absenteeism", shortLabel: "Absence", valueLabel: "Count", weight: 0.05 },
  { id: "punctuality", label: "Punctuality", shortLabel: "Punctuality", valueLabel: "Count", weight: 0.05 },
  { id: "excessiveBreak", label: "Excessive break", shortLabel: "Breaks", valueLabel: "Count", weight: 0.03 },
  { id: "pci", label: "PCI", shortLabel: "PCI", valueLabel: "Count", weight: 0.01 },
];

export const EVALUATION_BANDS = [
  { label: "Outstanding", min: 4.65 },
  { label: "Above Average", min: 4.4 },
  { label: "On Track", min: 4.0 },
  { label: "Needs Focus", min: 0 },
];

export const DEFAULT_KPI_SCORING_SETTINGS = {
  metrics: Object.fromEntries(KPI_METRICS.map((metric) => [metric.id, {
    weightPercent: metric.weight * 100,
    mode: "manual",
    direction: ["error", "absenteeism", "excessiveBreak"].includes(metric.id) ? "lower" : "higher",
    scoreFiveAt: "",
    scoreZeroAt: "",
  }])),
  evaluationBands: EVALUATION_BANDS.map((band) => ({ ...band })),
};

export function getKpiScoringSettings() {
  try {
    const saved = localStorage.getItem(KPI_SCORING_SETTINGS_KEY);
    if (!saved) return DEFAULT_KPI_SCORING_SETTINGS;
    const parsed = JSON.parse(saved);
    return {
      metrics: Object.fromEntries(KPI_METRICS.map((metric) => [metric.id, {
        ...DEFAULT_KPI_SCORING_SETTINGS.metrics[metric.id],
        ...(parsed.metrics?.[metric.id] ?? {}),
      }])),
      evaluationBands: Array.isArray(parsed.evaluationBands) && parsed.evaluationBands.length
        ? parsed.evaluationBands
        : DEFAULT_KPI_SCORING_SETTINGS.evaluationBands,
    };
  } catch {
    return DEFAULT_KPI_SCORING_SETTINGS;
  }
}

export function getMetricResult(record, metric, settings = getKpiScoringSettings()) {
  const result = record?.metrics?.[metric.id] ?? {};
  const rule = settings.metrics[metric.id];
  const raw = Number(result.rawValue);
  const rawIsPresent = result.rawValue !== "" && result.rawValue != null && Number.isFinite(raw);
  let equivalent = null;
  if (rule.mode === "formula" && rawIsPresent && rule.scoreFiveAt !== "" && rule.scoreZeroAt !== "") {
    const five = Number(rule.scoreFiveAt);
    const zero = Number(rule.scoreZeroAt);
    if (Number.isFinite(five) && Number.isFinite(zero) && five !== zero) {
      equivalent = rule.direction === "lower"
        ? ((zero - raw) / (zero - five)) * 5
        : ((raw - zero) / (five - zero)) * 5;
      equivalent = Math.max(0, Math.min(5, equivalent));
    }
  } else if (rule.mode !== "formula" && result.equivalentScore !== "" && result.equivalentScore != null && Number.isFinite(Number(result.equivalentScore))) {
    equivalent = Number(result.equivalentScore);
  }
  const weighted = equivalent !== null
    ? (equivalent * (Number(rule.weightPercent) || 0)) / 100
    : rule.mode === "manual" ? Number(result.weightedScore) || 0 : 0;
  return { ...result, equivalentScore: equivalent ?? "", weightedScore: weighted };
}

export const DEMO_MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];

export function emptyMetrics() {
  return Object.fromEntries(KPI_METRICS.map((metric) => [metric.id, {
    rawValue: "",
    equivalentScore: "",
    weightedScore: "",
    percentValue: metric.isPercent ? "" : null,
  }]));
}

export function getTeamMembers() {
  return getOrganizationMembers();
}

function makeDemoRecord(memberIndex, monthIndex, member) {
  const memberOffset = [0.13, 0.06, -0.02, 0.10, -0.05, 0.04, 0.01, -0.09][memberIndex % 8];
  const trendOffset = [-0.12, -0.08, -0.04, 0.01, 0.05, 0.09][monthIndex];
  const variance = (((memberIndex * 3 + monthIndex * 2) % 5) - 2) * 0.012;
  const qaPercent = Math.min(100, Math.max(91, 96.4 + memberOffset * 8 + trendOffset * 7 + variance * 5));
  const equivalentScores = {
    qa: qaPercent / 20,
    callsHandled: Math.min(5, Math.max(3.8, 4.42 + memberOffset + trendOffset + variance)),
    completionCount: Math.min(5, Math.max(4, 4.58 + memberOffset + trendOffset * 0.7 + variance)),
    error: Math.max(2.5, Math.min(5, 4.82 + memberOffset * 0.6 + trendOffset * 0.35 - variance)),
    kudos: [0, 2.5, 3.5, 0, 4, 2, 0, 3][memberIndex % 8],
    absenteeism: Math.max(2, Math.min(5, 4.7 + memberOffset * 0.7 + trendOffset * 0.3)),
    punctuality: Math.max(3.5, Math.min(5, 4.78 + memberOffset * 0.5 + trendOffset * 0.4)),
    excessiveBreak: Math.max(3, Math.min(5, 4.65 + memberOffset * 0.4 + trendOffset * 0.4)),
    pci: Math.max(3.5, Math.min(5, 4.8 + memberOffset * 0.35 + trendOffset * 0.4)),
  };
  const metrics = Object.fromEntries(KPI_METRICS.map((metric) => {
    const score = equivalentScores[metric.id];
    const baseCounts = {
      qa: qaPercent,
      callsHandled: 22 + ((memberIndex * 7 + monthIndex * 3) % 25),
      completionCount: 386 + ((memberIndex * 39 + monthIndex * 23) % 220),
      error: Math.max(0, Math.round((5 - score) * 0.9)),
      kudos: [0, 2, 3, 0, 4, 1, 0, 3][memberIndex % 8],
      absenteeism: Math.max(0, Math.round((5 - score) * 0.7)),
      punctuality: Math.max(0, Math.round((5 - score) * 1.1)),
      excessiveBreak: Math.max(0, Math.round((5 - score) * 1.2)),
      pci: Math.max(0, Math.round((5 - score) * 0.6)),
    };
    return [metric.id, {
      rawValue: Number(baseCounts[metric.id].toFixed(2)),
      equivalentScore: Number(score.toFixed(2)),
      weightedScore: Number((score * metric.weight).toFixed(3)),
      percentValue: metric.isPercent ? Number(qaPercent.toFixed(2)) : null,
    }];
  }));
  return { memberId: member.id, memberName: member.name, role: member.role, metrics, overallScore: null, evaluation: "" };
}

export function createDemoData(teamMembers) {
  return Object.fromEntries(DEMO_MONTHS.map((month, monthIndex) => [month, {
    demo: true,
    records: Object.fromEntries(teamMembers.map((member, memberIndex) => [member.id, makeDemoRecord(memberIndex, monthIndex, member)])),
  }]));
}

export function getOverallScore(record, settings = getKpiScoringSettings()) {
  return KPI_METRICS.reduce((total, metric) => total + getMetricResult(record, metric, settings).weightedScore, 0);
}

export function getEvaluation(score, settings = getKpiScoringSettings()) {
  return [...settings.evaluationBands].sort((a, b) => Number(b.min) - Number(a.min)).find((band) => score >= Number(band.min))?.label ?? "Needs Focus";
}

export function getMaximumKpiScore(settings = getKpiScoringSettings()) {
  return KPI_METRICS.reduce((total, metric) => total + (Number(settings.metrics[metric.id].weightPercent) || 0), 0) / 100 * 5;
}

export function getMonthLabel(month) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return "Choose month";
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(`${month}-15T12:00:00`));
}

export function getPreviousMonth(month) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(year, number - 2, 15);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function makeCsvTemplate() {
  const headers = ["Employee ID", "Name", "Role", ...KPI_METRICS.flatMap((metric) => {
    const label = metric.id === "qa" ? "QA Score" : metric.label.replace(/ count$/i, "");
    return [
      `${label} ${metric.isPercent ? "(%)" : "Count"}`,
      `${label} Equivalent Score`,
      `${label} Weighted Score`,
    ];
  }), "KPI Score", "Evaluation", "Rank"];
  return headers.join(",") + "\r\n";
}
