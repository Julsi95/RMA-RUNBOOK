import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight, ArrowUpRight, Award, BarChart3, CalendarDays, Check,
  Crown, Download, Medal, Plus, Search, Sparkles, Target, Trophy, Upload, X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import {
  createDemoData, emptyMetrics, getEvaluation, getKpiScoringSettings, getMaximumKpiScore, getMetricResult, getMonthLabel,
  getOverallScore, getPreviousMonth, getTeamMembers, KPI_METRICS, KPI_STORAGE_KEY, makeCsvTemplate,
} from "@/features/kpi/kpi-data";
import { readKpiFile } from "@/features/kpi/import-utils";
import "@/features/kpi/kpi-qa.css";

const TREND_RANGES = [6, 12];

function getLatestMonth(monthlyData) {
  return Object.keys(monthlyData).sort().at(-1) ?? new Date().toISOString().slice(0, 7);
}

function readSavedData(teamMembers) {
  try {
    const saved = localStorage.getItem(KPI_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    }
  } catch {
    // A fresh demo dataset is safer than leaving the page unusable if local data is malformed.
  }
  return createDemoData(teamMembers);
}

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function getMemberRecord(records, memberId) {
  return records?.[memberId] ?? null;
}

function getMetricValue(record, metricId, mode = "equivalent") {
  if (metricId === "overall") return getOverallScore(record);
  const metric = KPI_METRICS.find((item) => item.id === metricId);
  if (metric && mode === "equivalent") return Number(getMetricResult(record, metric).equivalentScore) || 0;
  const value = record?.metrics?.[metricId]?.[mode];
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function getBadges(row, previousRow, history, memberId, throughMonth) {
  const badges = [];
  const qa = Number(row.record?.metrics?.qa?.rawValue) || 0;
  const previousScore = previousRow ? getOverallScore(previousRow.record) : null;
  const change = previousScore == null ? 0 : row.score - previousScore;
  if (row.rank === 1) badges.push({ label: "Monthly MVP", icon: Crown });
  if (qa >= 99) badges.push({ label: "Quality Star", icon: Sparkles });
  if (change >= 0.12) badges.push({ label: "Most Improved", icon: ArrowUpRight });
  const streakMinimum = Number([...getKpiScoringSettings().evaluationBands].sort((a, b) => Number(b.min) - Number(a.min))[1]?.min ?? 4.4);
  let streak = 0;
  for (const month of Object.keys(history).filter((item) => /^\d{4}-\d{2}$/.test(item) && item <= throughMonth).sort().reverse()) {
    const record = getMemberRecord(history[month]?.records, memberId);
    if (!record || getOverallScore(record) < streakMinimum) break;
    streak += 1;
  }
  if (streak >= 3) badges.push({ label: `${streak}-month streak`, icon: Award });
  return badges.slice(0, 2);
}

function getTierProgress(score) {
  const bands = [...getKpiScoringSettings().evaluationBands].sort((a, b) => Number(b.min) - Number(a.min));
  const nextIndex = bands.findIndex((band) => score < Number(band.min));
  if (nextIndex < 0) return { label: "Top tier", percent: 100 };
  const nextBand = bands[nextIndex];
  const lower = Number(bands[nextIndex + 1]?.min ?? 0);
  const threshold = Number(nextBand.min);
  return { label: `Next tier · ${nextBand.label}`, percent: threshold > lower ? Math.max(0, Math.min(100, ((score - lower) / (threshold - lower)) * 100)) : 0 };
}

function formatScore(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function TrendChart({ months, monthlyData, teamMembers, metricMode, range, targetId, selectedMonth }) {
  const chartMonths = months.filter((month) => month <= selectedMonth).slice(-range);
  const values = chartMonths.map((month) => {
    const rows = targetId === "team"
      ? teamMembers.map((member) => monthlyData[month]?.records?.[member.id]).filter(Boolean)
      : [monthlyData[month]?.records?.[targetId]].filter(Boolean);
    const numbers = rows.map((record) => {
      if (metricMode !== "qa") return getOverallScore(record);
      const value = record.metrics?.qa?.rawValue;
      return value === "" || value == null ? Number.NaN : Number(value);
    }).filter(Number.isFinite);
    return { month, value: numbers.length ? numbers.reduce((sum, number) => sum + number, 0) / numbers.length : null };
  }).filter((item) => item.value != null);
  const isQa = metricMode === "qa";
  const min = isQa ? 90 : 0;
  const max = isQa ? 100 : Math.max(getMaximumKpiScore(), 0.1);
  const target = isQa ? 98 : Number([...getKpiScoringSettings().evaluationBands].sort((a, b) => Number(b.min) - Number(a.min))[0]?.min ?? max);
  const width = 760;
  const height = 215;
  const left = 43;
  const right = 17;
  const top = 15;
  const bottom = 35;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const points = values.map((item, index) => ({
    ...item,
    x: values.length === 1 ? left + plotWidth / 2 : left + (index / (values.length - 1)) * plotWidth,
    y: top + (1 - ((item.value - min) / (max - min))) * plotHeight,
  }));
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const ticks = isQa ? [90, 95, 100] : [0, max / 2, max];
  const targetY = top + (1 - ((Math.max(min, Math.min(max, target)) - min) / (max - min))) * plotHeight;
  const lastValue = values.at(-1)?.value;
  const priorValue = values.at(-2)?.value;
  const delta = lastValue == null || priorValue == null ? null : lastValue - priorValue;

  return (
    <>
    <svg className="kpi-trend-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${isQa ? "QA percentage" : "KPI score"} trend over ${points.length} months`}>
      {ticks.map((tick) => {
        const y = top + (1 - ((tick - min) / (max - min))) * plotHeight;
        return <g key={tick}><line x1={left} x2={width - right} y1={y} y2={y} className="kpi-chart-gridline" /><text x={left - 9} y={y + 4} textAnchor="end" className="kpi-chart-tick">{isQa ? `${tick}%` : tick.toFixed(2)}</text></g>;
      })}
      <line x1={left} x2={width - right} y1={targetY} y2={targetY} className="kpi-chart-target" />
      {points.length > 1 && <path d={line} className="kpi-chart-line" />}
      {points.map((point) => <g key={point.month}><circle cx={point.x} cy={point.y} r="4.5" className="kpi-chart-dot" /><text x={point.x} y={height - 10} textAnchor="middle" className="kpi-chart-month">{new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(`${point.month}-15T12:00:00`))}</text></g>)}
      {!points.length && <text x={width / 2} y={height / 2} textAnchor="middle" className="kpi-chart-tick">No scores in this range yet</text>}
    </svg>
    <div className="kpi-trend-footer"><span>Target · {isQa ? `${target}% QA` : `${target.toFixed(2)} KPI`}</span><span className={delta == null ? "" : delta >= 0 ? "kpi-positive" : "kpi-negative"}>{delta == null ? "Add another month to see progress" : `Last month ${delta >= 0 ? "+" : ""}${isQa ? `${delta.toFixed(2)}%` : delta.toFixed(2)}`}</span></div>
    </>
  );
}

function MemberAvatar({ member, large = false }) {
  return <span className={`kpi-avatar ${large ? "kpi-avatar-large" : ""}`}>{member?.photo ? <img src={member.photo} alt="" /> : initials(member?.name)}</span>;
}

function MemberDetailDialog({ member, record, previousRecord, teamAverage, onClose, onEdit }) {
  if (!member || !record) return null;
  const score = getOverallScore(record);
  const previousScore = previousRecord ? getOverallScore(previousRecord) : null;
  const delta = previousScore == null ? null : score - previousScore;
  return (
    <div className="kpi-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="kpi-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="kpi-detail-name">
        <div className="kpi-dialog-heading"><div className="kpi-dialog-person"><MemberAvatar member={member} large /><div><p className="kpi-overline">MONTHLY SCORECARD</p><h2 id="kpi-detail-name">{member.name}</h2><span>{member.role}</span></div></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close details"><X size={18} /></Button></div>
        <div className="kpi-detail-summary"><div><small>KPI score</small><strong>{formatScore(score)}</strong></div><div><small>Evaluation</small><strong>{getEvaluation(score)}</strong></div><div><small>Previous month</small><strong className={delta == null ? "" : delta >= 0 ? "kpi-positive" : "kpi-negative"}>{delta == null ? "—" : `${delta >= 0 ? "+" : ""}${formatScore(delta)}`}</strong></div><div><small>Team average</small><strong className={score >= teamAverage ? "kpi-positive" : "kpi-negative"}>{formatScore(teamAverage)}</strong></div></div>
        <div className="kpi-detail-metrics">
          {KPI_METRICS.map((metric) => {
            const result = getMetricResult(record, metric);
            const raw = result.rawValue === "" || result.rawValue == null ? "—" : metric.isPercent ? `${formatScore(result.rawValue, 2)}%` : `${result.rawValue} ${metric.valueLabel.toLowerCase()}`;
            const equivalent = result.equivalentScore === "" || result.equivalentScore == null ? "—" : formatScore(result.equivalentScore);
            const weighted = result.weightedScore === "" || result.weightedScore == null ? "—" : formatScore(result.weightedScore, 3);
            return <article className="kpi-detail-metric" key={metric.id}><div className="kpi-detail-metric-title"><strong>{metric.label}</strong><span>{raw}</span></div><div className="kpi-detail-metric-values"><span>Equivalent <b>{equivalent}</b></span><span>Weighted <b>{weighted}</b></span></div></article>;
          })}
        </div>
        <div className="kpi-dialog-actions"><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={onEdit}>Edit scores</Button></div>
      </section>
    </div>
  );
}

function ScoreEditorDialog({ teamMembers, initialMemberId, initialRecord, onClose, onSave }) {
  const [memberId, setMemberId] = useState(initialMemberId ?? teamMembers[0]?.id ?? "");
  const [draft, setDraft] = useState(() => initialRecord ?? { memberId, metrics: emptyMetrics(), overallScore: null, evaluation: "" });
  const [error, setError] = useState("");
  const activeMember = teamMembers.find((member) => member.id === memberId);
  const scoringSettings = getKpiScoringSettings();

  useEffect(() => {
    const member = teamMembers.find((item) => item.id === memberId);
    setDraft(initialMemberId === memberId && initialRecord ? initialRecord : { memberId, memberName: member?.name ?? "", role: member?.role ?? "", metrics: emptyMetrics(), overallScore: null, evaluation: "" });
  }, [memberId, initialMemberId, initialRecord, teamMembers]);

  function updateMetric(metricId, field, value) {
    const metric = KPI_METRICS.find((item) => item.id === metricId);
    setDraft((current) => {
      const updated = { ...current.metrics[metricId], [field]: value };
      const nextMetrics = { ...current.metrics, [metricId]: updated };
      const calculated = getMetricResult({ ...current, metrics: nextMetrics }, metric, scoringSettings);
      nextMetrics[metricId] = { ...updated, equivalentScore: calculated.equivalentScore, weightedScore: calculated.weightedScore };
      return { ...current, overallScore: null, metrics: nextMetrics };
    });
  }

  function submit(event) {
    event.preventDefault();
    if (!memberId) { setError("Choose a team member first."); return; }
    const member = teamMembers.find((item) => item.id === memberId);
    const metrics = Object.fromEntries(KPI_METRICS.map((metric) => {
      const result = getMetricResult(draft, metric, scoringSettings);
      return [metric.id, { ...draft.metrics?.[metric.id], equivalentScore: result.equivalentScore, weightedScore: result.weightedScore }];
    }));
    onSave({ ...draft, metrics, memberId, memberName: member.name, role: member.role, evaluation: "" });
  }

  return (
    <div className="kpi-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="kpi-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="kpi-editor-title">
        <div className="kpi-dialog-heading"><div><p className="kpi-overline">MONTHLY RESULT</p><h2 id="kpi-editor-title">Enter KPI scores</h2><span>Scores use the current admin scoring settings.</span></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close editor"><X size={18} /></Button></div>
        <form onSubmit={submit}>
          <label className="kpi-form-field kpi-member-select"><span>Team member</span><select value={memberId} onChange={(event) => setMemberId(event.target.value)}>{teamMembers.map((member) => <option value={member.id} key={member.id}>{member.name} · {member.role}</option>)}</select></label>
          <p className="kpi-score-rule-note">The page converts raw values according to each metric’s scoring method, applies its weight, and uses the admin evaluation bands for the total.</p>
          <div className="kpi-editor-grid">
            {KPI_METRICS.map((metric) => {
              const result = getMetricResult(draft, metric, scoringSettings);
              const rule = scoringSettings.metrics[metric.id];
              return <fieldset className="kpi-editor-metric" key={metric.id}><legend>{metric.label}</legend><label><span>{metric.valueLabel}</span><input inputMode="decimal" type="number" step="any" value={draft.metrics?.[metric.id]?.rawValue ?? ""} onChange={(event) => updateMetric(metric.id, "rawValue", event.target.value)} placeholder="—" /></label><label><span>{rule.mode === "formula" ? "Calculated / 5" : "Equivalent / 5"}</span><input inputMode="decimal" type="number" min="0" max="5" step="0.01" value={result.equivalentScore ?? ""} onChange={(event) => updateMetric(metric.id, "equivalentScore", event.target.value)} placeholder="—" readOnly={rule.mode === "formula"} /></label><label><span>Weighted · {Number(rule.weightPercent).toFixed(1)}%</span><output>{result.equivalentScore === "" ? "—" : formatScore(result.weightedScore, 3)}</output></label></fieldset>;
            })}
          </div>
          {error && <p className="kpi-form-error">{error}</p>}
          <div className="kpi-dialog-actions"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit"><Check size={15} /> Save monthly result</Button></div>
        </form>
      </section>
    </div>
  );
}

function ImportDialog({ teamMembers, selectedMonth, onClose, onImport }) {
  const [staged, setStaged] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(selectedMonth);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setLoading(true);
    try {
      const result = await readKpiFile(file, teamMembers);
      if (result.tables.length > 1 && result.tables.some((table) => !table.month)) throw new Error("This workbook has multiple monthly sections but one or more month labels were not recognized. Add a month label above each section, or upload each month separately.");
      setStaged(result);
    } catch (parseError) {
      setError(parseError.message || "We could not read this file.");
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  }

  return (
    <div className="kpi-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="kpi-import-dialog" role="dialog" aria-modal="true" aria-labelledby="kpi-import-title">
        <div className="kpi-dialog-heading"><div><p className="kpi-overline">BULK UPDATE</p><h2 id="kpi-import-title">Import monthly results</h2><span>Upload an Excel workbook or CSV for the selected month.</span></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close import"><X size={18} /></Button></div>
        <label className="kpi-form-field"><span>Fallback month when the file has no month heading</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
        <label className={`kpi-upload-dropzone ${staged ? "kpi-upload-ready" : ""}`}>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} /><span className="kpi-upload-icon">{staged ? <Check size={19} /> : <Upload size={19} />}</span><strong>{loading ? "Reading file…" : staged ? staged.fileName : "Choose a CSV or Excel file"}</strong><small>Use the provided template for the most reliable column matching.</small>
        </label>
        <div className="kpi-import-help"><p>Matched team members will be updated for the selected or detected month. Other members’ results stay as they are.</p><Button variant="outline" size="sm" onClick={() => { const blob = new Blob([makeCsvTemplate()], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "monthly-kpi-template.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}><Download size={14} /> Download template</Button></div>
        {staged && <div className="kpi-import-preview"><div className="kpi-preview-title"><strong>Import preview · {staged.fileName}</strong><span>{staged.tables.reduce((total, table) => total + table.imported.length, 0)} matched</span></div>{staged.tables.map((table, index) => <div className="kpi-import-table-preview" key={`${table.month ?? month}-${index}`}><div className="kpi-preview-title"><strong>{table.month ? getMonthLabel(table.month) : getMonthLabel(month)}</strong><span>{table.imported.length} people</span></div><div className="kpi-preview-people">{table.imported.slice(0, 6).map((row) => <span key={row.memberId}>{row.memberName}</span>)}{table.imported.length > 6 && <span>+{table.imported.length - 6} more</span>}</div>{table.missingColumns.length > 0 && <p className="kpi-import-warning">Columns not matched: {table.missingColumns.join(", ")}. Those values will be blank.</p>}{table.unmatched.length > 0 && <p className="kpi-import-warning">Not found in the team roster: {table.unmatched.join(", ")}. These rows will be skipped.</p>}{table.repeated.length > 0 && <p className="kpi-import-warning">Duplicate rows found for {table.repeated.join(", ")}; the last matching row will be used.</p>}</div>)}</div>}
        {error && <p className="kpi-form-error">{error}</p>}
        <div className="kpi-dialog-actions"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!staged || !month || !staged.tables.some((table) => table.imported.length)} onClick={() => onImport(staged.tables.map((table) => ({ month: table.month ?? month, imported: table.imported })))}><Upload size={15} /> Import {staged?.tables.length ?? 0} {staged?.tables.length === 1 ? "month" : "months"}</Button></div>
      </section>
    </div>
  );
}

export default function KpiQaPage() {
  const [teamMembers] = useState(getTeamMembers);
  const [monthlyData, setMonthlyData] = useState(() => readSavedData(teamMembers));
  const [selectedMonth, setSelectedMonth] = useState(() => getLatestMonth(readSavedData(teamMembers)));
  const [monthDraft, setMonthDraft] = useState("");
  const [range, setRange] = useState(6);
  const [trendMetric, setTrendMetric] = useState("qa");
  const [trendTarget, setTrendTarget] = useState("team");
  const [compareMetric, setCompareMetric] = useState("overall");
  const [compareOpen, setCompareOpen] = useState(false);
  const [comparisonSubject, setComparisonSubject] = useState("");
  const [comparisonPeer, setComparisonPeer] = useState("");
  const [compareMode, setCompareMode] = useState("previous");
  const [detailMemberId, setDetailMemberId] = useState(null);
  const [editingMemberId, setEditingMemberId] = useState(null);
  const [showImporter, setShowImporter] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    localStorage.setItem(KPI_STORAGE_KEY, JSON.stringify(monthlyData));
  }, [monthlyData]);

  const monthOptions = useMemo(() => [...new Set([...Object.keys(monthlyData), selectedMonth])].filter(Boolean).sort(), [monthlyData, selectedMonth]);
  const records = monthlyData[selectedMonth]?.records ?? {};
  const previousMonth = getPreviousMonth(selectedMonth);
  const previousRecords = monthlyData[previousMonth]?.records ?? {};
  const leaderboard = teamMembers.map((member) => {
    const record = getMemberRecord(records, member.id);
    return { member, record, score: record ? getOverallScore(record) : 0 };
  }).filter((row) => row.record).sort((a, b) => b.score - a.score || a.member.name.localeCompare(b.member.name)).map((row, index) => ({ ...row, rank: index + 1 }));
  const previousLeaderboard = teamMembers.map((member) => ({ member, record: previousRecords[member.id] })).filter((row) => row.record).sort((a, b) => getOverallScore(b.record) - getOverallScore(a.record) || a.member.name.localeCompare(b.member.name));
  const filteredLeaderboard = leaderboard.filter(({ member }) => `${member.name} ${member.role}`.toLowerCase().includes(search.trim().toLowerCase()));
  const rankedTeam = leaderboard.length;
  const teamAverage = rankedTeam ? leaderboard.reduce((sum, row) => sum + row.score, 0) / rankedTeam : 0;
  const qaValues = leaderboard.map((row) => row.record.metrics?.qa?.rawValue).filter((value) => value !== "" && value != null && Number.isFinite(Number(value))).map(Number);
  const averageQa = qaValues.length ? qaValues.reduce((sum, value) => sum + value, 0) / qaValues.length : 0;
  const topPerformer = leaderboard[0];
  const selectedRecord = getMemberRecord(records, detailMemberId);
  const selectedMember = teamMembers.find((member) => member.id === detailMemberId);
  const comparePrimary = teamMembers.some((member) => member.id === comparisonSubject) ? comparisonSubject : leaderboard[0]?.member.id ?? teamMembers[0]?.id ?? "";
  const compareOtherMember = comparisonPeer && comparisonPeer !== comparePrimary ? comparisonPeer : leaderboard.find((row) => row.member.id !== comparePrimary)?.member.id ?? teamMembers.find((member) => member.id !== comparePrimary)?.id ?? "";
  const compareSecondMonth = compareMode === "previous" ? previousRecords[comparePrimary] : records[compareOtherMember];
  const comparePrimaryRecord = records[comparePrimary];
  const trendMonths = monthOptions;
  const isDemo = Boolean(monthlyData[selectedMonth]?.demo);

  function getRankMovement(memberId, currentRank) {
    const previousPosition = previousLeaderboard.findIndex((row) => row.member.id === memberId);
    if (previousPosition < 0) return null;
    return previousPosition + 1 - currentRank;
  }

  function createMonth(month) {
    if (!month) return;
    setSelectedMonth(month);
    setMonthlyData((current) => current[month] ? current : { ...current, [month]: { demo: false, records: {} } });
  }

  function saveRecord(record) {
    setMonthlyData((current) => ({
      ...current,
      [selectedMonth]: {
        ...(current[selectedMonth] ?? { records: {} }),
        demo: false,
        records: { ...(current[selectedMonth]?.demo ? {} : current[selectedMonth]?.records ?? {}), [record.memberId]: record },
      },
    }));
    setEditingMemberId(null);
  }

  function importRecords(imports) {
    setMonthlyData((current) => imports.reduce((next, { month, imported }) => ({
      ...next,
      [month]: { ...(next[month] ?? { records: {} }), demo: false, records: { ...(next[month]?.demo ? {} : next[month]?.records ?? {}), ...Object.fromEntries(imported.map((record) => [record.memberId, record])) } },
    }), current));
    setSelectedMonth(imports.map(({ month }) => month).sort().at(-1) ?? selectedMonth);
    setShowImporter(false);
  }

  function openAddResult() {
    const memberWithoutRecord = teamMembers.find((member) => !records[member.id]);
    setEditingMemberId(memberWithoutRecord?.id ?? teamMembers[0]?.id ?? null);
  }

  function getPreviousRow(memberId) {
    return previousRecords[memberId] ? { record: previousRecords[memberId] } : null;
  }

  return (
    <section className="page-content kpi-page">
      <div className="page-heading kpi-page-heading">
        <div><p className="eyebrow">TEAM PERFORMANCE</p><h1>Monthly KPI / QA</h1><p className="page-description">Track quality, results and progress across your team.</p></div>
        <div className="kpi-heading-actions"><Button variant="outline" onClick={() => setShowImporter(true)}><Upload size={15} /> Import file</Button><Button onClick={openAddResult}><Plus size={16} /> Enter results</Button></div>
      </div>

      <div className="kpi-month-toolbar">
        <div className="kpi-month-control"><span className="kpi-toolbar-icon"><CalendarDays size={17} /></span><label><small>Viewing month</small><Select value={selectedMonth} onValueChange={setSelectedMonth}><SelectTrigger className="kpi-month-select-trigger" aria-label="Viewing month"><SelectValue /></SelectTrigger><SelectContent>{monthOptions.map((month) => <SelectItem key={month} value={month}>{getMonthLabel(month)}{monthlyData[month]?.demo ? " · Demo" : ""}</SelectItem>)}</SelectContent></Select></label></div>
        <div className="kpi-new-month-container">
          <label className="kpi-new-month"><span>New month</span><input type="month" value={monthDraft} onChange={(event) => { setMonthDraft(event.target.value); createMonth(event.target.value); }} aria-label="Create or open month" /></label>
        </div>
        {isDemo && <span className="kpi-demo-pill"><Sparkles size={13} /> Demo data · replace with your monthly scores</span>}
        {!isDemo && <span className="kpi-saved-indicator"><span /> Saved in this browser</span>}
      </div>

      <section className="kpi-trend-panel">
        <div className="kpi-section-head"><div><p className="kpi-overline">LONG-TERM PROGRESS</p><h2>Performance trend</h2><p>Follow the team over time; the selected month sets the chart endpoint.</p></div><div className="kpi-chart-controls"><select value={trendMetric} onChange={(event) => setTrendMetric(event.target.value)} aria-label="Trend metric"><option value="qa">QA score · percent</option><option value="overall">KPI score · weighted</option></select><select value={trendTarget} onChange={(event) => setTrendTarget(event.target.value)} aria-label="Trend subject"><option value="team">Team average</option>{teamMembers.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select><div className="kpi-range-toggle">{TREND_RANGES.map((item) => <button type="button" className={range === item ? "active" : ""} key={item} onClick={() => setRange(item)}>{item} mo</button>)}</div></div></div>
        <div className="kpi-chart-summary"><span className="kpi-chart-legend"><i />{trendTarget === "team" ? "Team average" : teamMembers.find((member) => member.id === trendTarget)?.name}<small>·</small><span className="kpi-target-key">Dashed line · starter target</span></span><span>Through {getMonthLabel(selectedMonth)}</span></div>
        <TrendChart months={trendMonths} monthlyData={monthlyData} teamMembers={teamMembers} metricMode={trendMetric} range={range} targetId={trendTarget} selectedMonth={selectedMonth} />
      </section>

      <div className="kpi-summary-grid">
        <article className="kpi-summary-card"><span className="kpi-summary-icon"><BarChart3 size={17} /></span><div><small>TEAM KPI AVERAGE</small><strong>{rankedTeam ? formatScore(teamAverage) : "—"}<em>/ {getMaximumKpiScore().toFixed(2)}</em></strong><span>{getEvaluation(teamAverage)}</span></div></article>
        <article className="kpi-summary-card"><span className="kpi-summary-icon"><Target size={17} /></span><div><small>AVERAGE QA SCORE</small><strong>{rankedTeam ? `${formatScore(averageQa, 2)}%` : "—"}</strong><span>Across {rankedTeam} team members</span></div></article>
        <article className="kpi-summary-card kpi-top-summary"><span className="kpi-summary-icon"><Trophy size={17} /></span><div><small>MONTH LEADER</small><strong>{topPerformer?.member.name ?? "No results yet"}</strong><span>{topPerformer ? `${formatScore(topPerformer.score)} KPI · rank #1` : "Enter or import results"}</span></div></article>
        <article className="kpi-summary-card"><span className="kpi-summary-icon"><Medal size={17} /></span><div><small>RESULTS ENTERED</small><strong>{rankedTeam}<em> / {teamMembers.length}</em></strong><span>For {getMonthLabel(selectedMonth)}</span></div></article>
      </div>

      <section className="kpi-comparison-panel">
        <div className="kpi-section-head kpi-comparison-head"><div><p className="kpi-overline">EVERYONE AT A GLANCE</p><h2>Team comparison</h2><p>See all team members on the same scale. Select a person for their full scorecard.</p></div><div className="kpi-comparison-controls"><label className="kpi-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a person" /></label><select value={compareMetric} onChange={(event) => setCompareMetric(event.target.value)} aria-label="Comparison metric"><option value="overall">Overall KPI</option>{KPI_METRICS.map((metric) => <option value={metric.id} key={metric.id}>{metric.label} · {metric.isPercent ? "percent" : "equivalent"}</option>)}</select><Button variant="outline" onClick={() => setCompareOpen((open) => !open)}>{compareOpen ? "Close compare" : "Compare"}</Button></div></div>
        {leaderboard.length ? <div className="kpi-team-bars">{[...filteredLeaderboard].sort((a, b) => {
          const aValue = compareMetric === "overall" ? a.score : getMetricValue(a.record, compareMetric, compareMetric === "qa" ? "rawValue" : "equivalentScore");
          const bValue = compareMetric === "overall" ? b.score : getMetricValue(b.record, compareMetric, compareMetric === "qa" ? "rawValue" : "equivalentScore");
          return bValue - aValue;
        }).map((row, index) => {
          const value = compareMetric === "overall" ? row.score : getMetricValue(row.record, compareMetric, compareMetric === "qa" ? "rawValue" : "equivalentScore");
          const max = compareMetric === "overall" ? getMaximumKpiScore() : compareMetric === "qa" ? 100 : 5;
          const prior = getPreviousRow(row.member.id);
          const delta = prior ? value - getMetricValue(prior.record, compareMetric, compareMetric === "qa" ? "rawValue" : "equivalentScore") : null;
          return <button className="kpi-team-bar-row" type="button" key={row.member.id} onClick={() => setDetailMemberId(row.member.id)}><span className="kpi-bar-rank">{String(index + 1).padStart(2, "0")}</span><MemberAvatar member={row.member} /><span className="kpi-bar-name"><strong>{row.member.name}</strong><small>{row.member.role}</small></span><span className="kpi-bar-track"><i style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} /></span><strong className="kpi-bar-value">{compareMetric === "qa" ? `${formatScore(value, 2)}%` : formatScore(value)}</strong><span className={`kpi-bar-delta ${delta == null ? "" : delta >= 0 ? "kpi-positive" : "kpi-negative"}`}>{delta == null ? "New" : <>{delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{delta >= 0 ? "+" : ""}{compareMetric === "qa" ? `${formatScore(delta, 2)}%` : formatScore(delta)}</>}</span></button>;
        })}</div> : <div className="kpi-empty-state"><BarChart3 size={22} /><strong>No monthly results yet</strong><span>Enter scores or import your monthly file to populate the dashboard.</span><div><Button variant="outline" onClick={() => setShowImporter(true)}><Upload size={14} /> Import results</Button><Button onClick={openAddResult}><Plus size={14} /> Enter first result</Button></div></div>}
        {compareOpen && <div className="kpi-compare-drawer"><div className="kpi-compare-drawer-head"><div><p className="kpi-overline">HEAD-TO-HEAD</p><h3>Compare performance</h3></div><div className="kpi-compare-pickers"><label><span>Person</span><select value={comparePrimary} onChange={(event) => setComparisonSubject(event.target.value)}>{teamMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label><span>Against</span><select value={compareMode} onChange={(event) => setCompareMode(event.target.value)}><option value="previous">Previous month</option><option value="person">Another person</option></select></label>{compareMode === "person" && <label><span>Team member</span><select value={compareOtherMember} onChange={(event) => setComparisonPeer(event.target.value)}>{teamMembers.filter((member) => member.id !== comparePrimary).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}</div></div><div className="kpi-head-to-head-labels"><span>{teamMembers.find((member) => member.id === comparePrimary)?.name ?? "Person"}</span><span>{compareMode === "previous" ? getMonthLabel(previousMonth) : teamMembers.find((member) => member.id === compareOtherMember)?.name ?? "Person"}</span></div><div className="kpi-head-to-head"><div className="kpi-head-to-head-row"><span>Overall KPI</span><div><i className="kpi-bar-first" style={{ width: `${getMaximumKpiScore() ? (getOverallScore(comparePrimaryRecord) / getMaximumKpiScore()) * 100 : 0}%` }} /><i className="kpi-bar-second" style={{ width: `${getMaximumKpiScore() ? (getOverallScore(compareSecondMonth) / getMaximumKpiScore()) * 100 : 0}%` }} /></div><strong>{formatScore(getOverallScore(comparePrimaryRecord))} <small>·</small> {formatScore(getOverallScore(compareSecondMonth))}</strong></div>{KPI_METRICS.map((metric) => { const a = getMetricValue(comparePrimaryRecord, metric.id); const b = getMetricValue(compareSecondMonth, metric.id); return <div className="kpi-head-to-head-row" key={metric.id}><span>{metric.shortLabel}</span><div><i className="kpi-bar-first" style={{ width: `${(a / 5) * 100}%` }} /><i className="kpi-bar-second" style={{ width: `${(b / 5) * 100}%` }} /></div><strong>{formatScore(a)} <small>·</small> {formatScore(b)}</strong></div>; })}</div><p className="kpi-compare-footnote">Bars show equivalent score out of 5. The first value belongs to the selected month.</p></div>}
      </section>

      <section className="kpi-leaderboard-section">
        <div className="kpi-section-head"><div><p className="kpi-overline">MONTHLY RANKINGS</p><h2>Leaderboard</h2><p>Scores, rank movement and milestones for {getMonthLabel(selectedMonth)}.</p></div><span className="kpi-leaderboard-season"><Trophy size={14} /> Season · {getMonthLabel(selectedMonth)}</span></div>
        {leaderboard.length > 0 && <div className="kpi-podium-grid">{[leaderboard[1], leaderboard[0], leaderboard[2]].filter(Boolean).map((row) => {
          const previous = getPreviousRow(row.member.id);
          const movement = getRankMovement(row.member.id, row.rank);
          const progress = getTierProgress(row.score);
          const badges = getBadges(row, previous, monthlyData, row.member.id, selectedMonth);
          return <button className={`kpi-podium-card kpi-podium-${row.rank}`} type="button" key={row.member.id} onClick={() => setDetailMemberId(row.member.id)}><span className="kpi-podium-place">{row.rank === 1 ? <Crown size={18} /> : row.rank === 2 ? <Medal size={17} /> : <Award size={17} />}<b>#{row.rank}</b></span><MemberAvatar member={row.member} large /><strong className="kpi-podium-name">{row.member.name}</strong><span className="kpi-podium-role">{row.member.role}</span><b className="kpi-podium-score">{formatScore(row.score)}<small> / {getMaximumKpiScore().toFixed(2)}</small></b><span className="kpi-podium-evaluation">{getEvaluation(row.score)}</span><span className="kpi-podium-tier"><span>{progress.label} · {Math.round(progress.percent)}%</span><i><em style={{ width: `${progress.percent}%` }} /></i></span><span className={`kpi-podium-movement ${movement == null ? "" : movement > 0 ? "kpi-positive" : movement < 0 ? "kpi-negative" : ""}`}>{movement == null ? "New this month" : movement > 0 ? `↑ ${movement} place${movement === 1 ? "" : "s"}` : movement < 0 ? `↓ ${Math.abs(movement)} place${movement === -1 ? "" : "s"}` : "— Same rank"}</span><div className="kpi-badge-list">{badges.map(({ label, icon: Icon }) => <span className="kpi-achievement-badge" key={label}><Icon size={11} />{label}</span>)}</div><span className="kpi-podium-base">{row.rank === 1 ? "MONTH MVP" : `RANK ${row.rank}`}</span></button>;
        })}</div>}
        {leaderboard.length > 3 && <div className="kpi-ranking-list">{leaderboard.slice(3).map((row) => {
          const prior = getPreviousRow(row.member.id);
          const movement = getRankMovement(row.member.id, row.rank);
          const progress = getTierProgress(row.score);
          const badges = getBadges(row, prior, monthlyData, row.member.id, selectedMonth);
          return <button type="button" className="kpi-ranking-row" key={row.member.id} onClick={() => setDetailMemberId(row.member.id)}><span className="kpi-ranking-number">#{row.rank}</span><MemberAvatar member={row.member} /><span className="kpi-ranking-person"><strong>{row.member.name}</strong><small>{row.member.role}</small></span><span className="kpi-tier-progress"><span><small>{progress.label}</small><b>{Math.round(progress.percent)}%</b></span><i><em style={{ width: `${progress.percent}%` }} /></i></span><span className="kpi-ranking-badges">{badges.map(({ label, icon: Icon }) => <span className="kpi-achievement-badge" key={label}><Icon size={11} />{label}</span>)}</span><span className={`kpi-rank-change ${movement == null ? "" : movement > 0 ? "kpi-positive" : movement < 0 ? "kpi-negative" : ""}`}>{movement == null ? "NEW" : movement > 0 ? <><ArrowUpRight size={14} />{movement} up</> : movement < 0 ? <><ArrowDownRight size={14} />{Math.abs(movement)} down</> : "—"}</span><strong className="kpi-ranking-score">{formatScore(row.score)}</strong></button>;
        })}</div>}
        {!leaderboard.length && <div className="kpi-empty-state kpi-empty-compact"><Trophy size={22} /><strong>Rankings appear after scores are entered</strong><span>Complete a monthly result for your team to generate the leaderboard.</span></div>}
      </section>

      <section className="kpi-roster-card"><div className="kpi-roster-heading"><div><p className="kpi-overline">MONTHLY SCORECARDS</p><h2>Team results</h2><p>Open a profile for detailed metric scores, or edit that month’s results.</p></div><Button variant="outline" onClick={openAddResult}><Plus size={15} /> Add / edit result</Button></div><div className="kpi-member-card-grid">{teamMembers.map((member) => {
        const record = records[member.id];
        const row = leaderboard.find((item) => item.member.id === member.id);
        const previous = getPreviousRow(member.id);
        const delta = record && previous ? getOverallScore(record) - getOverallScore(previous.record) : null;
        return <article className={`kpi-member-card ${!record ? "kpi-member-card-empty" : ""}`} key={member.id}><button className="kpi-member-card-main" type="button" onClick={() => record && setDetailMemberId(member.id)} disabled={!record}><span className="kpi-member-card-top"><MemberAvatar member={member} /><span className="kpi-member-card-rank">{row ? `#${row.rank}` : "—"}</span></span><strong>{member.name}</strong><small>{member.role}</small><span className="kpi-member-card-score">{record ? formatScore(getOverallScore(record)) : "No result"}<em>{record ? `/ ${getMaximumKpiScore().toFixed(2)}` : ""}</em></span><span className="kpi-member-card-evaluation">{record ? getEvaluation(getOverallScore(record)) : "Add this month’s scores"}</span><span className={`kpi-member-card-delta ${delta == null ? "" : delta >= 0 ? "kpi-positive" : "kpi-negative"}`}>{delta == null ? "No previous month" : `${delta >= 0 ? "+" : ""}${formatScore(delta)} vs last month`}</span></button><button className="kpi-card-edit" type="button" onClick={() => setEditingMemberId(member.id)}>{record ? "Edit" : "Enter score"}</button></article>;
      })}</div></section>

      {selectedMember && selectedRecord && <MemberDetailDialog member={selectedMember} record={selectedRecord} previousRecord={previousRecords[selectedMember.id]} teamAverage={teamAverage} onClose={() => setDetailMemberId(null)} onEdit={() => { setEditingMemberId(selectedMember.id); setDetailMemberId(null); }} />}
      {editingMemberId && <ScoreEditorDialog key={`${selectedMonth}-${editingMemberId}`} teamMembers={teamMembers} initialMemberId={editingMemberId} initialRecord={records[editingMemberId] ?? null} onClose={() => setEditingMemberId(null)} onSave={saveRecord} />}
      {showImporter && <ImportDialog teamMembers={teamMembers} selectedMonth={selectedMonth} onClose={() => setShowImporter(false)} onImport={importRecords} />}
    </section>
  );
}
