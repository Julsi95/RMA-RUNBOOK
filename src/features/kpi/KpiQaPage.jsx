import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight, ArrowUpRight, Award, BarChart3, CalendarDays, Check,
  Crown, Download, Medal, Plus, RefreshCw, RotateCcw, Search, Sparkles, Target, Trophy, Upload, X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useOrganizationRoster } from "@/app/organization-provider";
import { getOperationalRoster } from "@/features/organization/organization-data";
import { useAuth } from "@/app/auth-provider";
import { isSupabaseConfigured } from "@/lib/supabase";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import {
  createDemoData, emptyMetrics, getEvaluation, getKpiScoringSettings, getMaximumKpiScore, getMetricResult, getMonthLabel,
  getOverallScore, getPreviousMonth, KPI_METRICS, makeCsvTemplate,
} from "@/features/kpi/kpi-data";
import { readKpiFile } from "@/features/kpi/import-utils";
import { buildKpiPersonGroups } from "@/features/kpi/kpi-person-groups";
import { getConsecutiveTopThreeStreak, getImportedKpiRank } from "@/features/kpi/kpi-ranking";
import { createKpiMonth, loadCurrentKpiScoring, replaceKpiMonthResults, resetKpiMonthResults, saveKpiMonthResults } from "@/lib/backend-repositories";
import { retryDataLoad, subscribeToTables } from "@/lib/backend/shared";
import { fetchCachedQuery, queryClient, queryKeys, readCachedQuery } from "@/lib/backend/query-cache";
import { fetchKpiMonth, fetchKpiMonthIndex, invalidateKpiMonth, kpiIndexKey, readKpiMonth, updateCachedKpiMonth, updateCachedKpiMonthIndex } from "@/features/kpi/kpi-cache";
import "@/features/kpi/kpi-qa.css";

const TREND_RANGES = [6, 12];
const KPI_SCORING_QUERY_KEY = queryKeys.kpiScoring();

function getLatestMonth(monthlyData) {
  const populated = Object.entries(monthlyData)
    .filter(([, month]) => Object.keys(month?.records ?? {}).length > 0)
    .map(([month]) => month)
    .sort();
  return populated.at(-1) ?? Object.keys(monthlyData).sort().at(-1) ?? new Date().toISOString().slice(0, 7);
}

function readSavedData(teamMembers) {
  return createDemoData(teamMembers);
}

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function getMemberRecord(records, memberId) {
  return records?.[memberId] ?? null;
}

function settingsOf(record) {
  return record?.scoringSettings ?? getKpiScoringSettings();
}

function getRecordScore(record, settings = settingsOf(record)) {
  if (record?.source === "import") {
    return record.overallScore !== "" && record.overallScore != null && Number.isFinite(Number(record.overallScore))
      ? Number(record.overallScore)
      : 0;
  }
  return getOverallScore(record, settings);
}

function getRecordEvaluation(record, score, settings = settingsOf(record)) {
  return record?.source === "import"
    ? record.evaluation ?? ""
    : getEvaluation(score, settings);
}

function getRecordMetricResult(record, metric, settings = settingsOf(record)) {
  return record?.source === "import"
    ? { ...record.metrics?.[metric.id], rawValue: record.metrics?.[metric.id]?.rawValue ?? "", equivalentScore: record.metrics?.[metric.id]?.equivalentScore ?? "", weightedScore: record.metrics?.[metric.id]?.weightedScore ?? "" }
    : getMetricResult(record, metric, settings);
}

function getMetricValue(record, metricId, mode = "equivalent") {
  if (metricId === "overall") return getRecordScore(record, settingsOf(record));
  const metric = KPI_METRICS.find((item) => item.id === metricId);
  if (metric && mode === "equivalent") return Number(getRecordMetricResult(record, metric, settingsOf(record)).equivalentScore) || 0;
  const value = record?.metrics?.[metricId]?.[mode];
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function getBadges(row, previousRow, history, memberId, throughMonth) {
  const badges = [];
  const qa = Number(row.record?.metrics?.qa?.rawValue) || 0;
  const previousScore = previousRow ? getRecordScore(previousRow.record, settingsOf(previousRow.record)) : null;
  const change = previousScore == null ? 0 : row.score - previousScore;
  if (row.rank === 1) badges.push({ label: "Monthly MVP", icon: Crown });
  if (qa >= 99) badges.push({ label: "Quality Star", icon: Sparkles });
  if (change >= 0.12) badges.push({ label: "Most Improved", icon: ArrowUpRight });
  const streak = getConsecutiveTopThreeStreak(history, memberId, throughMonth, (record) => getRecordScore(record, settingsOf(record)));
  const streakBadge = streak >= 3 ? { label: `${streak}-month Top Agent streak`, icon: Award } : null;
  if (streakBadge) badges.push(streakBadge);
  const priorityBadges = badges.filter((badge) => badge.label === "Monthly MVP" || badge === streakBadge);
  const otherBadges = badges.filter((badge) => badge.label !== "Monthly MVP" && badge !== streakBadge);
  return [...priorityBadges, ...otherBadges].slice(0, 2);
}

function getTierProgress(score, settings = getKpiScoringSettings()) {
  const bands = [...settings.evaluationBands].sort((a, b) => Number(b.min) - Number(a.min));
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

const TrendChart = lazy(() => import("@/features/kpi/KpiTrendChart"));
const KpiInsightsCharts = lazy(() => import("@/features/kpi/KpiInsightsCharts"));

function VisibleChartRegion({ label, onVisible, children }) {
  const regionRef = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible || !regionRef.current) return undefined;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); onVisible?.(); return undefined; }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisible(true);
      onVisible?.();
      observer.disconnect();
    }, { rootMargin: "80px" });
    observer.observe(regionRef.current);
    return () => observer.disconnect();
  }, [onVisible, visible]);
  return <div ref={regionRef} data-chart-region={label}>{visible ? children : <div className="kpi-chart-empty">Chart loads when this section is near view.</div>}</div>;
}

function MemberAvatar({ member, large = false }) {
  return <span className={`kpi-avatar ${large ? "kpi-avatar-large" : ""}`}>{member?.photo ? <img src={member.photo} alt="" loading="lazy" decoding="async" /> : initials(member?.name)}</span>;
}

function MemberDetailDialog({ member, record, previousRecord, teamAverage, onClose, onEdit, canEdit }) {
  if (!member || !record) return null;
  const scoringSettings = settingsOf(record);
  const score = getRecordScore(record, scoringSettings);
  const previousScore = previousRecord ? getRecordScore(previousRecord, settingsOf(previousRecord)) : null;
  const delta = previousScore == null ? null : score - previousScore;
  return (
    <div className="kpi-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="kpi-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="kpi-detail-name">
        <div className="kpi-dialog-heading"><div className="kpi-dialog-person"><MemberAvatar member={member} large /><div><p className="kpi-overline">MONTHLY SCORECARD</p><h2 id="kpi-detail-name">{member.name}</h2><span>{member.role}</span></div></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close details"><X size={18} /></Button></div>
        <div className="kpi-detail-summary"><div><small>KPI score</small><strong>{formatScore(score)}</strong></div><div><small>Evaluation</small><strong>{getRecordEvaluation(record, score, scoringSettings)}</strong></div><div><small>Previous month</small><strong className={delta == null ? "" : delta >= 0 ? "kpi-positive" : "kpi-negative"}>{delta == null ? "—" : `${delta >= 0 ? "+" : ""}${formatScore(delta)}`}</strong></div><div><small>Team average</small><strong className={score >= teamAverage ? "kpi-positive" : "kpi-negative"}>{formatScore(teamAverage)}</strong></div></div>
        <div className="kpi-detail-metrics">
          {KPI_METRICS.map((metric) => {
            const result = getRecordMetricResult(record, metric, scoringSettings);
            const raw = result.rawValue === "" || result.rawValue == null ? "—" : metric.isPercent ? `${formatScore(result.rawValue, 2)}%` : `${result.rawValue} ${metric.valueLabel.toLowerCase()}`;
            const equivalent = result.equivalentScore === "" || result.equivalentScore == null ? "—" : formatScore(result.equivalentScore);
            const weighted = result.weightedScore === "" || result.weightedScore == null ? "—" : formatScore(result.weightedScore, 3);
            return <article className="kpi-detail-metric" key={metric.id}><div className="kpi-detail-metric-title"><strong>{metric.label}</strong><span>{raw}</span></div><div className="kpi-detail-metric-values"><span>Equivalent <b>{equivalent}</b></span><span>Weighted <b>{weighted}</b></span></div></article>;
          })}
        </div>
        <div className="kpi-dialog-actions"><Button variant="outline" onClick={onClose}>Close</Button>{canEdit && <Button onClick={onEdit}>Edit scores</Button>}</div>
      </section>
    </div>
  );
}

function ScoreEditorDialog({ teamMembers, initialMemberId, initialRecord, scoringSettings, onClose, onSave }) {
  const [memberId, setMemberId] = useState(initialMemberId ?? teamMembers[0]?.id ?? "");
  const [draft, setDraft] = useState(() => initialRecord ?? { memberId, metrics: emptyMetrics(), overallScore: null, evaluation: "" });
  const [error, setError] = useState("");
  const activeMember = teamMembers.find((member) => member.id === memberId);

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
        <div className="kpi-dialog-heading"><div><p className="kpi-overline">MONTHLY RESULT</p><h2 id="kpi-editor-title">Enter KPI scores</h2><span>Scores use the rules saved for this month.</span></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close editor"><X size={18} /></Button></div>
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

  function updateImported(tableIndex, rowIndex, update) {
    setStaged((current) => ({
      ...current,
      tables: current.tables.map((table, index) => index !== tableIndex ? table : {
        ...table,
        imported: table.imported.map((row, indexInTable) => {
          if (indexInTable !== rowIndex) return row;
          const next = typeof update === "function" ? update(row) : { ...row, ...update };
          if (next.memberId && next.memberId !== row.memberId) {
            const member = teamMembers.find((item) => item.id === next.memberId);
            return { ...next, memberName: member?.name ?? next.memberName, role: member?.role ?? next.role, historical: !member };
          }
          return next;
        }),
      }),
    }));
  }

  const totalRows = staged?.tables.reduce((total, table) => total + table.imported.length, 0) ?? 0;
  const matchedRows = staged?.tables.reduce((total, table) => total + table.imported.filter((row) => teamMembers.some((member) => member.id === row.memberId)).length, 0) ?? 0;
  const historicalRows = staged?.tables.reduce((total, table) => total + table.imported.filter((row) => row.historical).length, 0) ?? 0;
  const invalidRows = staged?.tables.some((table) => {
    const ids = table.imported.map((row) => row.memberId).filter(Boolean);
    return ids.length !== table.imported.length || new Set(ids).size !== ids.length;
  }) ?? true;

  return (
    <div className="kpi-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="kpi-import-dialog" role="dialog" aria-modal="true" aria-labelledby="kpi-import-title">
        <div className="kpi-dialog-heading"><div><p className="kpi-overline">BULK UPDATE</p><h2 id="kpi-import-title">Import monthly results</h2><span>Upload, review, edit, and save the spreadsheet values as provided.</span></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close import"><X size={18} /></Button></div>
        <label className="kpi-form-field"><span>Fallback month when the file has no month heading</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
        <label className={`kpi-upload-dropzone ${staged ? "kpi-upload-ready" : ""}`}>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} /><span className="kpi-upload-icon">{staged ? <Check size={19} /> : <Upload size={19} />}</span><strong>{loading ? "Reading file…" : staged ? staged.fileName : "Choose a CSV or Excel file"}</strong><small>CSV, XLSX, or XLS · up to 10 MB and 2,000 result rows. Review every value before saving.</small>
        </label>
        <div className="kpi-import-help"><p>Each uploaded month replaces that month’s scoreboard. People omitted from this file are removed from the current month view; earlier versions remain recoverable for 30 days. Scores and ranks stay as uploaded.</p><Button variant="outline" size="sm" onClick={() => { const blob = new Blob([makeCsvTemplate()], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "monthly-kpi-template.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}><Download size={14} /> Download template</Button></div>
        {staged && <div className="kpi-import-preview"><div className="kpi-preview-title"><strong>Review · {staged.fileName}</strong><span>{matchedRows} matched ? {historicalRows} historical ? {totalRows} total</span></div>{staged.tables.map((table, tableIndex) => <div className="kpi-import-table-preview" key={`${table.month ?? month}-${tableIndex}`}><div className="kpi-preview-title"><strong>{table.month ? getMonthLabel(table.month) : getMonthLabel(month)}</strong><span>{table.imported.length} rows</span></div>{table.missingColumns.length > 0 && <p className="kpi-import-warning">Columns not found: {table.missingColumns.join(", ")}. Found headers: {table.headers.join(", ") || "none"}. Missing spreadsheet fields will remain blank.</p>}{table.imported.some((row) => row.historical) && <p className="kpi-import-history-note">Unmatched people are saved as historical records only. No account or roster entry is created.</p>}{new Set(table.imported.map((row) => row.memberId).filter(Boolean)).size < table.imported.filter((row) => row.memberId).length && <p className="kpi-import-warning">Each person can appear only once in a month. Remove duplicate rows before saving.</p>}
          <div className="kpi-import-grid-wrap"><table className="kpi-import-grid"><thead><tr><th>Spreadsheet name</th><th>Result name</th><th>Role snapshot</th><th>Save as</th>{KPI_METRICS.map((metric) => <th key={metric.id} colSpan="3">{metric.label}</th>)}<th>KPI score</th><th>Evaluation</th><th>Rank</th><th /></tr><tr><th /><th /><th /><th />{KPI_METRICS.flatMap((metric) => [<th key={`${metric.id}-raw`}>{metric.isPercent ? "Score %" : "Count"}</th>, <th key={`${metric.id}-equiv`}>Equivalent</th>, <th key={`${metric.id}-weighted`}>Weighted</th>])}<th /><th /><th /><th /></tr></thead><tbody>{table.imported.map((row, rowIndex) => <tr key={row.importRowId ?? `${row.sourceName}-${rowIndex}`} className={row.historical ? "kpi-import-unmatched" : ""}><td>{row.sourceName}</td><td><input aria-label={`${row.sourceName} result name`} type="text" value={row.memberName} onChange={(event) => updateImported(tableIndex, rowIndex, { memberName: event.target.value })} /></td><td><input aria-label={`${row.sourceName} role snapshot`} type="text" value={row.role ?? ""} onChange={(event) => updateImported(tableIndex, rowIndex, { role: event.target.value })} /></td><td><select value={row.memberId} onChange={(event) => updateImported(tableIndex, rowIndex, { memberId: event.target.value })}><option value={row.memberId}>{row.historical ? "Historical record (not on roster)" : row.memberName}</option>{teamMembers.filter((member) => member.id !== row.memberId).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></td>{KPI_METRICS.flatMap((metric) => ["rawValue", "equivalentScore", "weightedScore"].map((field) => <td key={`${metric.id}-${field}`}><input aria-label={`${row.sourceName} ${metric.label} ${field}`} type="number" step="any" value={row.metrics?.[metric.id]?.[field] ?? ""} onChange={(event) => updateImported(tableIndex, rowIndex, (current) => ({ ...current, metrics: { ...current.metrics, [metric.id]: { ...current.metrics?.[metric.id], [field]: event.target.value, ...(field === "rawValue" && metric.isPercent ? { percentValue: event.target.value } : {}) } } }))} /></td>))}<td><input aria-label={`${row.sourceName} KPI score`} type="number" step="any" value={row.overallScore ?? ""} onChange={(event) => updateImported(tableIndex, rowIndex, { overallScore: event.target.value === "" ? null : Number(event.target.value) })} /></td><td><input aria-label={`${row.sourceName} evaluation`} type="text" value={row.evaluation ?? ""} onChange={(event) => updateImported(tableIndex, rowIndex, { evaluation: event.target.value })} /></td><td><input aria-label={`${row.sourceName} rank`} type="text" value={row.importedRank ?? ""} onChange={(event) => updateImported(tableIndex, rowIndex, { importedRank: event.target.value })} /></td><td><button className="kpi-import-remove" type="button" onClick={() => setStaged((current) => ({ ...current, tables: current.tables.map((item, index) => index !== tableIndex ? item : { ...item, imported: item.imported.filter((_, i) => i !== rowIndex) }) }))} aria-label={`Remove ${row.sourceName}`}>×</button></td></tr>)}</tbody></table></div>
        </div>)}</div>}
        {error && <p className="kpi-form-error">{error}</p>}
        <div className="kpi-dialog-actions"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!staged || !month || !staged.tables.some((table) => table.imported.length) || invalidRows} onClick={() => onImport(staged.tables.map((table) => ({ month: table.month ?? month, imported: table.imported })))}><Upload size={15} /> Save {staged?.tables.length ?? 0} {staged?.tables.length === 1 ? "month" : "months"}</Button></div>
      </section>
    </div>
  );
}

export default function KpiQaPage() {
  const { members: rosterMembers } = useOrganizationRoster();
  const teamMembers = useMemo(() => getOperationalRoster(rosterMembers), [rosterMembers]);
  const { canEdit, user } = useAuth();
  const userId = user?.id ?? "anonymous";
  const monthsKey = useMemo(() => kpiIndexKey(userId), [userId]);
  const scoringKey = KPI_SCORING_QUERY_KEY;
  const cachedIndex = readCachedQuery(monthsKey) ?? [];
  const cachedMonths = Object.fromEntries(cachedIndex.map(({ month_key: key }) => [key, readKpiMonth(userId, key)]).filter(([, data]) => Boolean(data)));
  const initialMonth = getLatestMonth(cachedMonths);
  const [monthlyData, setMonthlyData] = useState(() => isSupabaseConfigured ? cachedMonths ?? {} : readSavedData(teamMembers));
  const [monthIndex, setMonthIndex] = useState(cachedIndex);
  const [currentScoring, setCurrentScoring] = useState(() => readCachedQuery(scoringKey) ?? null);
  const [selectedMonth, setSelectedMonth] = useState(() => initialMonth);
  const [pageUserId, setPageUserId] = useState(userId);
  const [remoteReady, setRemoteReady] = useState(!isSupabaseConfigured || Boolean(cachedMonths[initialMonth]));
  const monthlyDataRef = useRef(monthlyData);
  monthlyDataRef.current = monthlyData;
  const selectedMonthRef = useRef(selectedMonth);
  selectedMonthRef.current = selectedMonth;
  const [syncError, setSyncError] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [creatingMonth, setCreatingMonth] = useState(false);
  const remoteSnapshotRef = useRef(Object.keys(cachedMonths).length ? structuredClone(cachedMonths) : null);
  const importingRef = useRef(false);
  const hiddenAtRef = useRef(0);
  const [monthDraft, setMonthDraft] = useState("");
  const [range, setRange] = useState(6);
  const [trendVisible, setTrendVisible] = useState(false);
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
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resettingMonth, setResettingMonth] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (pageUserId === userId) return;
    const nextIndex = readCachedQuery(kpiIndexKey(userId)) ?? [];
    const nextMonths = Object.fromEntries(nextIndex.map(({ month_key: key }) => [key, readKpiMonth(userId, key)]).filter(([, data]) => Boolean(data)));
    const nextMonth = getLatestMonth(nextMonths);
    setPageUserId(userId);
    setMonthIndex(nextIndex);
    setMonthlyData(isSupabaseConfigured ? nextMonths : readSavedData(teamMembers));
    setSelectedMonth(nextMonth);
    setCurrentScoring(readCachedQuery(scoringKey) ?? null);
    setRemoteReady(!isSupabaseConfigured || Boolean(nextMonths[nextMonth]));
    remoteSnapshotRef.current = Object.keys(nextMonths).length ? structuredClone(nextMonths) : null;
    setSyncError("");
  }, [pageUserId, scoringKey, teamMembers, userId]);

  const mergeCachedMonth = useCallback((month, data) => {
    if (!month || !data) return data;
    remoteSnapshotRef.current = { ...(remoteSnapshotRef.current ?? {}), [month]: data };
    setMonthlyData((current) => current[month] === data ? current : { ...current, [month]: data });
    return data;
  }, []);

  const refreshMonth = useCallback(async (month, { checkRevision = false, forceContent = false } = {}) => {
    if (!month) return null;
    const data = await fetchKpiMonth(userId, month, { checkRevision, forceContent });
    if (data) mergeCachedMonth(month, data);
    return data;
  }, [mergeCachedMonth, userId]);

  const ensureMonths = useCallback(async (months) => {
    const uniqueMonths = [...new Set(months.filter(Boolean))];
    return Promise.all(uniqueMonths.map((month) => refreshMonth(month)));
  }, [refreshMonth]);

  const refreshSelectedMonth = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setSyncError("");
    try {
      const [index, scoring, data] = await Promise.all([
        fetchKpiMonthIndex(userId, { force: true }),
        fetchCachedQuery(scoringKey, () => retryDataLoad(loadCurrentKpiScoring), { staleTime: Infinity, gcTime: Infinity, force: true }),
        fetchKpiMonth(userId, selectedMonth, { checkRevision: true }),
      ]);
      setMonthIndex(index);
      setCurrentScoring(scoring);
      if (data) mergeCachedMonth(selectedMonth, data);
    } catch (error) { setSyncError(error.message || "Could not refresh the selected KPI month."); }
  }, [mergeCachedMonth, scoringKey, selectedMonth, userId]);

  const refreshLoadedMonths = useCallback(async () => {
    const loadedMonths = Object.keys(monthlyDataRef.current);
    await Promise.all(loadedMonths.map((month) => refreshMonth(month, { checkRevision: true })));
  }, [refreshMonth]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    void Promise.all([
      fetchKpiMonthIndex(userId),
      fetchCachedQuery(scoringKey, () => retryDataLoad(loadCurrentKpiScoring), { staleTime: Infinity, gcTime: Infinity }),
    ]).then(async ([index, savedScoring]) => {
      if (!active) return;
      setMonthIndex(index);
      setCurrentScoring(savedScoring);
      const candidates = index.map((item) => item.month_key).sort((a, b) => b.localeCompare(a));
      let selected = candidates[0] ?? new Date().toISOString().slice(0, 7);
      for (const candidate of candidates) {
        const saved = await fetchKpiMonth(userId, candidate);
        if (!active) return;
        if (saved) mergeCachedMonth(candidate, saved);
        if (Object.keys(saved?.records ?? {}).length) { selected = candidate; break; }
      }
      if (!active) return;
      setSelectedMonth(selected);
      setRemoteReady(true);
      setSyncError("");
    }).catch((error) => { if (active) { setSyncError(error.message || "Could not load KPI results."); setRemoteReady(true); } });
    return () => { active = false; };
  }, [mergeCachedMonth, scoringKey, userId]);

  useEffect(() => {
    if (!isSupabaseConfigured || !remoteReady || !selectedMonth || monthlyData[selectedMonth]) return undefined;
    let active = true;
    void refreshMonth(selectedMonth).then(() => { if (active) setRemoteReady(true); }).catch((error) => { if (active) setSyncError(error.message || "Could not load this KPI month."); });
    return () => { active = false; };
  }, [monthlyData, refreshMonth, remoteReady, selectedMonth]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    let timer;
    const handleReconnect = async () => {
      const [index, scoring] = await Promise.all([
        fetchKpiMonthIndex(userId, { force: true }),
        fetchCachedQuery(scoringKey, () => retryDataLoad(loadCurrentKpiScoring), { staleTime: Infinity, gcTime: Infinity, force: true }),
      ]);
      if (!active) return;
      setMonthIndex(index); setCurrentScoring(scoring);
      await refreshLoadedMonths();
    };
    const unsubscribe = subscribeToTables(["kpi_months", "kpi_results", "current_kpi_scoring", "kpi_scoring_versions", "qa_criteria"], (payload) => {
      if (!active || importingRef.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const table = payload?.table;
        const row = payload?.new ?? payload?.old ?? {};
        if (payload?.type === "RECONNECT") { void handleReconnect().catch((error) => { if (active) setSyncError(error.message || "Could not refresh KPI data after reconnecting."); }); return; }
        if (table === "kpi_results") {
          const affectedMonth = row.month_key;
          if (affectedMonth && (readKpiMonth(userId, affectedMonth) || affectedMonth === selectedMonthRef.current)) void refreshMonth(affectedMonth, { checkRevision: true }).catch((error) => { if (active) setSyncError(error.message || "Could not sync KPI changes."); });
          else if (affectedMonth) invalidateKpiMonth(userId, affectedMonth);
        } else if (table === "kpi_months") {
          void fetchKpiMonthIndex(userId, { force: true }).then((index) => { if (active) setMonthIndex(index); });
          if (row.month_key && (readKpiMonth(userId, row.month_key) || row.month_key === selectedMonthRef.current)) {
            void fetchKpiMonthIndex(userId, { force: true }).then((index) => { setMonthIndex(index); return refreshMonth(row.month_key, { forceContent: true }); }).catch((error) => { if (active) setSyncError(error.message || "Could not sync KPI month settings."); });
          }
          else if (row.month_key) invalidateKpiMonth(userId, row.month_key);
        } else if (table === "current_kpi_scoring") {
          void fetchCachedQuery(scoringKey, () => retryDataLoad(loadCurrentKpiScoring), { staleTime: Infinity, gcTime: Infinity, force: true }).then((scoring) => { if (active) setCurrentScoring(scoring); });
        } else if (table === "kpi_scoring_versions" && row.id) {
          queryClient.removeQueries({ queryKey: queryKeys.kpiScoringVersion(row.id), exact: true });
          void Promise.all(Object.entries(monthlyDataRef.current).filter(([, data]) => data.scoringVersionId === row.id).map(([month]) => refreshMonth(month, { forceContent: true })));
        } else if (table === "qa_criteria") {
          void queryClient.invalidateQueries({ queryKey: ["qa-criteria"], refetchType: "none" });
        }
      }, 180);
    }, "monthly-kpi");
    let fallbackTimer = null;
    const startFallback = () => {
      if (fallbackTimer !== null || document.visibilityState !== "visible") return;
      fallbackTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") void handleReconnect().catch((error) => { if (active) setSyncError(error.message || "Could not refresh KPI data."); });
      }, 10 * 60 * 1000);
    };
    const stopFallback = () => { if (fallbackTimer !== null) window.clearInterval(fallbackTimer); fallbackTimer = null; };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") { hiddenAtRef.current = Date.now(); stopFallback(); return; }
      if (hiddenAtRef.current && Date.now() - hiddenAtRef.current >= 10 * 60 * 1000) void handleReconnect().catch((error) => { if (active) setSyncError(error.message || "Could not refresh KPI data after returning."); });
      hiddenAtRef.current = 0;
      startFallback();
    };
    startFallback();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => { active = false; stopFallback(); window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibilityChange); unsubscribe(); };
  }, [refreshMonth, refreshLoadedMonths, scoringKey, userId]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    if (!remoteReady || !canEdit || !remoteSnapshotRef.current) return undefined;
    const changedByMonth = Object.entries(monthlyData).map(([month, data]) => {
      const prior = remoteSnapshotRef.current[month]?.records ?? {};
      const changed = Object.entries(data.records ?? {}).filter(([memberId, record]) => JSON.stringify(record) !== JSON.stringify(prior[memberId]));
      return [month, changed.map(([, record]) => record)];
    }).filter(([, changed]) => changed.length);
    if (!changedByMonth.length) return undefined;
    const timeout = window.setTimeout(async () => {
      try {
        await Promise.all(changedByMonth.map(([month, records]) => saveKpiMonthResults(month, records)));
        remoteSnapshotRef.current = { ...remoteSnapshotRef.current };
        for (const [month, records] of changedByMonth) {
          const snapshot = { ...(remoteSnapshotRef.current[month] ?? monthlyData[month]), records: { ...(remoteSnapshotRef.current[month]?.records ?? {}) } };
          for (const record of records) snapshot.records[record.memberId] = record;
          remoteSnapshotRef.current[month] = snapshot;
        }
        await Promise.all(changedByMonth.map(([month]) => {
          invalidateKpiMonth(userId, month);
          return fetchKpiMonth(userId, month, { forceContent: true }).then((saved) => mergeCachedMonth(month, saved));
        }));
        setSyncError("");
      } catch (error) { setSyncError(error.message || "Could not save KPI results."); }
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [monthlyData, remoteReady, canEdit, mergeCachedMonth, userId]);

  const monthOptions = useMemo(() => [...new Set([...monthIndex.map((item) => item.month_key), ...Object.keys(monthlyData), selectedMonth])].filter(Boolean).sort(), [monthIndex, monthlyData, selectedMonth]);
  const records = monthlyData[selectedMonth]?.records ?? {};
  const allPersonGroups = useMemo(() => buildKpiPersonGroups(monthOptions, monthlyData, teamMembers), [monthOptions, monthlyData, teamMembers]);
  const resolvedRecordsByMonth = useMemo(() => {
    const resolved = {};
    for (const person of allPersonGroups) {
      for (const [month, record] of Object.entries(person.recordsByMonth)) {
        resolved[month] ??= {};
        resolved[month][person.id] = record;
      }
    }
    return resolved;
  }, [allPersonGroups]);
  const peopleWithHistory = useMemo(() => {
    const people = new Map(allPersonGroups.map(({ recordsByMonth, ...person }) => [person.id, person]));
    for (const member of teamMembers) people.set(member.id, member);
    return [...people.values()];
  }, [allPersonGroups, teamMembers]);
  const scoreboardMembers = useMemo(() => {
    const people = new Map(teamMembers.map((member) => [member.id, member]));
    for (const person of allPersonGroups) if (person.recordsByMonth[selectedMonth] && !people.has(person.id)) people.set(person.id, { id: person.id, name: person.name, role: person.role, historical: person.historical });
    return [...people.values()];
  }, [allPersonGroups, selectedMonth, teamMembers]);
  const previousMonth = getPreviousMonth(selectedMonth);
  const previousRecords = resolvedRecordsByMonth[previousMonth] ?? {};
  const currentResolvedRecords = resolvedRecordsByMonth[selectedMonth] ?? {};
  const selectedScoringSettings = monthlyData[selectedMonth]?.scoringSettings ?? currentScoring?.settings ?? getKpiScoringSettings();
  const leaderboard = scoreboardMembers.map((member) => {
    const record = getMemberRecord(currentResolvedRecords, member.id) ?? getMemberRecord(records, member.id);
    const importedRank = record?.source === "import" ? String(record.metrics?._importedRank ?? "").trim() : "";
    const explicitRank = getImportedKpiRank(record);
    return { member, record, score: record ? getRecordScore(record, settingsOf(record)) : 0, importedRank, explicitRank };
  }).filter((row) => row.record).sort((a, b) => {
    if (a.explicitRank != null && b.explicitRank != null && a.explicitRank !== b.explicitRank) return a.explicitRank - b.explicitRank;
    if (a.explicitRank != null && b.explicitRank == null) return -1;
    if (a.explicitRank == null && b.explicitRank != null) return 1;
    return b.score - a.score || a.member.name.localeCompare(b.member.name);
  }).map((row, index) => ({ ...row, rank: row.explicitRank ?? index + 1, rankLabel: row.importedRank || String(row.explicitRank ?? index + 1) }));
  const previousLeaderboard = Object.entries(previousRecords).map(([memberId, record]) => ({ member: peopleWithHistory.find((person) => person.id === memberId) ?? { id: memberId, name: record.memberName || "Former roster member", role: record.role || "Historical record", historical: true }, record })).map((row) => {
    const importedRank = row.record.source === "import" ? String(row.record.metrics?._importedRank ?? "").trim() : "";
    return { ...row, rank: getImportedKpiRank(row.record) };
  }).sort((a, b) => a.rank != null && b.rank != null ? a.rank - b.rank : a.rank != null ? -1 : b.rank != null ? 1 : getRecordScore(b.record, settingsOf(b.record)) - getRecordScore(a.record, settingsOf(a.record)) || a.member.name.localeCompare(b.member.name));
  const filteredLeaderboard = leaderboard.filter(({ member }) => `${member.name} ${member.role}`.toLowerCase().includes(search.trim().toLowerCase()));
  const rankedTeam = leaderboard.length;
  const teamAverage = rankedTeam ? leaderboard.reduce((sum, row) => sum + row.score, 0) / rankedTeam : 0;
  const qaValues = leaderboard.map((row) => row.record.metrics?.qa?.rawValue).filter((value) => value !== "" && value != null && Number.isFinite(Number(value))).map(Number);
  const averageQa = qaValues.length ? qaValues.reduce((sum, value) => sum + value, 0) / qaValues.length : 0;
  const topPerformer = leaderboard[0];
  const selectedRecord = getMemberRecord(currentResolvedRecords, detailMemberId) ?? getMemberRecord(records, detailMemberId);
  const selectedMember = scoreboardMembers.find((member) => member.id === detailMemberId);
  const comparePrimary = scoreboardMembers.some((member) => member.id === comparisonSubject) ? comparisonSubject : leaderboard[0]?.member.id ?? teamMembers[0]?.id ?? "";
  const compareOtherMember = comparisonPeer && comparisonPeer !== comparePrimary ? comparisonPeer : leaderboard.find((row) => row.member.id !== comparePrimary)?.member.id ?? scoreboardMembers.find((member) => member.id !== comparePrimary)?.id ?? "";
  const compareSecondMonth = compareMode === "previous" ? previousRecords[comparePrimary] : currentResolvedRecords[compareOtherMember] ?? records[compareOtherMember];
  const comparePrimaryRecord = currentResolvedRecords[comparePrimary] ?? records[comparePrimary];
  const trendMonths = monthOptions;
  const isDemo = Boolean(monthlyData[selectedMonth]?.demo);
  const selectedMaximum = getMaximumKpiScore(selectedScoringSettings);

  function getRankMovement(memberId, currentRank) {
    const previous = previousLeaderboard.find((row) => row.member.id === memberId);
    if (!previous) return null;
    return (previous.rank ?? previousLeaderboard.indexOf(previous) + 1) - currentRank;
  }

  const requestTrendMonths = useCallback(() => {
    const needed = monthOptions.filter((month) => month <= selectedMonth).slice(-range);
    void ensureMonths(needed).catch((error) => setSyncError(error.message || "Could not load historical KPI months."));
  }, [ensureMonths, monthOptions, range, selectedMonth]);

  const requestHistoryYear = useCallback((year) => {
    const needed = monthOptions.filter((month) => month.startsWith(`${year}-`) && month <= selectedMonth);
    void ensureMonths(needed).catch((error) => setSyncError(error.message || "Could not load historical KPI months."));
  }, [ensureMonths, monthOptions, selectedMonth]);

  useEffect(() => { if (trendVisible) requestTrendMonths(); }, [requestTrendMonths, trendVisible]);

  async function createMonth(month) {
    if (!month) return;
    if (monthlyData[month]) { setSelectedMonth(month); return; }
    setSyncError(""); setSyncMessage("");
    if (!isSupabaseConfigured) {
      setSelectedMonth(month);
      setMonthlyData((current) => ({ ...current, [month]: { demo: false, scoringSettings: getKpiScoringSettings(), records: {} } }));
      setSyncMessage("KPI month created in this browser.");
      return;
    }
    if (!canEdit) { setSyncError("Sign in with an editor account to create a KPI month."); return; }
    setCreatingMonth(true);
    setSyncError("");
    try {
      const created = await createKpiMonth(month);
      const monthData = { demo: false, scoringVersionId: created.scoringVersionId, scoringSettings: created.scoringSettings, records: {} };
      remoteSnapshotRef.current = { ...(remoteSnapshotRef.current ?? {}), [month]: monthData };
      updateCachedKpiMonth(userId, month, monthData);
      const index = updateCachedKpiMonthIndex(userId, (current) => [...current.filter((item) => item.month_key !== month), { month_key: month, scoring_version_id: created.scoringVersionId, status: "published" }].sort((a, b) => a.month_key.localeCompare(b.month_key)));
      setMonthIndex(index);
      setMonthlyData((current) => ({ ...current, [month]: current[month] ?? monthData }));
      setSelectedMonth(month);
      setSyncMessage(getMonthLabel(month) + " KPI month created successfully.");
    } catch (error) { setSyncError(error.message || "Could not create this KPI month."); }
    finally { setCreatingMonth(false); }
  }

  async function resetSelectedMonth() {
    const monthToReset = selectedMonth;
    const currentRecords = monthlyData[monthToReset]?.records ?? {};
    if (!canEdit || !Object.keys(currentRecords).length || resettingMonth) return;
    setResettingMonth(true);
    setShowResetConfirm(false);
    setSyncError("");
    setSyncMessage("");
    try {
      let saved;
      if (isSupabaseConfigured) {
        importingRef.current = true;
        const removedCount = await resetKpiMonthResults(monthToReset);
        invalidateKpiMonth(userId, monthToReset);
        saved = await fetchKpiMonth(userId, monthToReset, { forceContent: true });
        if (saved) mergeCachedMonth(monthToReset, saved);
        const candidates = [...monthIndex].map((item) => item.month_key).filter((month) => month !== monthToReset).sort((a, b) => b.localeCompare(a));
        let latest = new Date().toISOString().slice(0, 7);
        for (const candidate of candidates) {
          const candidateData = await refreshMonth(candidate);
          if (Object.keys(candidateData?.records ?? {}).length) { latest = candidate; break; }
        }
        setSelectedMonth(latest);
        setSyncMessage(`${getMonthLabel(monthToReset)} reset. ${removedCount} result${removedCount === 1 ? "" : "s"} removed from the live scoreboard; the reset can be restored from History for 30 days.`);
      } else {
        saved = {
          ...monthlyData,
          [monthToReset]: { ...monthlyData[monthToReset], records: {} },
        };
        setMonthlyData(saved);
        setSelectedMonth(getLatestMonth(saved));
        setSyncMessage(`${getMonthLabel(monthToReset)} results reset in this browser.`);
      }
    } catch (error) {
      setSyncError(error.message || `Could not reset ${getMonthLabel(monthToReset)} results.`);
      if (isSupabaseConfigured) {
        try {
          const refreshed = await fetchKpiMonth(userId, monthToReset, { forceContent: true });
          if (refreshed) mergeCachedMonth(monthToReset, refreshed);
        } catch { /* Keep the reset error visible if recovery refresh also fails. */ }
      }
    } finally {
      importingRef.current = false;
      setResettingMonth(false);
    }
  }

  function saveRecord(record) {
    const monthData = monthlyData[selectedMonth];
    const scoringSettings = monthData?.scoringSettings ?? getKpiScoringSettings();
    const metrics = Object.fromEntries(KPI_METRICS.map((metric) => {
      const result = getMetricResult(record, metric, scoringSettings);
      return [metric.id, { ...record.metrics?.[metric.id], equivalentScore: result.equivalentScore, weightedScore: result.weightedScore }];
    }));
    const prepared = {
      ...record,
      metrics,
      scoringVersionId: monthData?.scoringVersionId ?? null,
      scoringSettings,
      overallScore: getOverallScore({ ...record, metrics }, scoringSettings),
      evaluation: getEvaluation(getOverallScore({ ...record, metrics }, scoringSettings), scoringSettings),
      source: "manual",
    };
    setMonthlyData((current) => ({
      ...current,
      [selectedMonth]: {
        ...(current[selectedMonth] ?? { records: {}, scoringSettings }),
        demo: false,
        records: { ...(current[selectedMonth]?.demo ? {} : current[selectedMonth]?.records ?? {}), [record.memberId]: prepared },
      },
    }));
    setEditingMemberId(null);
  }

  async function importRecords(imports) {
    importingRef.current = true;
    try {
      let next = { ...monthlyData };
      const affectedMonths = [];
      for (const { month, imported } of imports) {
        const monthData = next[month] ?? await refreshMonth(month);
        affectedMonths.push(month);
        if (isSupabaseConfigured && !canEdit) throw new Error("Sign in with an editor account to import KPI results.");
        const scoringSettings = monthData?.scoringSettings ?? getKpiScoringSettings();
        const converted = imported.map((record) => ({
          ...record,
          metrics: { ...record.metrics, _importedRank: record.importedRank ?? "" },
          overallScore: record.overallScore,
          evaluation: record.evaluation ?? "",
          scoringSettings,
          scoringVersionId: monthData?.scoringVersionId ?? null,
          source: "import",
        }));
        if (isSupabaseConfigured) {
          await replaceKpiMonthResults(month, converted);
          invalidateKpiMonth(userId, month);
        }
        next[month] = { ...(monthData ?? { records: {} }), demo: false, scoringSettings, records: Object.fromEntries(converted.map((record) => [record.memberId, record])) };
      }
      if (isSupabaseConfigured) {
        const [index, ...savedMonths] = await Promise.all([
          fetchKpiMonthIndex(userId, { force: true }),
          ...[...new Set(affectedMonths)].map((month) => fetchKpiMonth(userId, month, { forceContent: true })),
        ]);
        setMonthIndex(index);
        for (let i = 0; i < [...new Set(affectedMonths)].length; i += 1) {
          const month = [...new Set(affectedMonths)][i];
          const saved = savedMonths[i];
          if (saved) { next[month] = saved; mergeCachedMonth(month, saved); }
        }
      }
      setMonthlyData(next);
      setSelectedMonth(getLatestMonth(next));
      setShowImporter(false);
      setSyncError("");
      setSyncMessage(`Replaced results for ${imports.length} ${imports.length === 1 ? "month" : "months"}.`);
    } catch (error) {
      setSyncError(error.message || "Could not import KPI results.");
      if (isSupabaseConfigured) {
        try {
          await Promise.all([...new Set(imports.map((item) => item.month))].map((month) => refreshMonth(month, { forceContent: true })));
        } catch { /* Keep the original import error visible if refresh also fails. */ }
      }
    } finally {
      importingRef.current = false;
    }
  }

  function openAddResult() {
    const memberWithoutRecord = teamMembers.find((member) => !records[member.id]);
    setEditingMemberId(memberWithoutRecord?.id ?? teamMembers[0]?.id ?? null);
  }

  function openPersonDetails(member) {
    setDetailMemberId(member.id);
  }

  function getPreviousRow(memberId) {
    return previousRecords[memberId] ? { record: previousRecords[memberId] } : null;
  }

  if (pageUserId !== userId) return <section className="page-content kpi-page"><div className="kpi-empty-state"><BarChart3 size={22} /><strong>Loading this account’s KPI data…</strong></div></section>;

  return (
    <section className="page-content kpi-page">
      <div className="page-heading kpi-page-heading">
        <div><p className="eyebrow">TEAM PERFORMANCE</p><h1>Monthly KPI / QA</h1><p className="page-description">Track quality, results and progress across your team.</p></div>
        <div className="kpi-heading-actions"><Button variant="outline" onClick={() => void refreshSelectedMonth()} disabled={!isSupabaseConfigured || !remoteReady}><RefreshCw size={15} /> Refresh</Button>{canEdit && <><Button variant="outline" onClick={() => setShowImporter(true)}><Upload size={15} /> Import file</Button><Button onClick={openAddResult}><Plus size={16} /> Enter results</Button></>}</div>
      </div>

      <div className="kpi-month-toolbar">
        <div className="kpi-month-control"><span className="kpi-toolbar-icon"><CalendarDays size={17} /></span><label><small>Viewing month</small><Select value={selectedMonth} onValueChange={setSelectedMonth}><SelectTrigger className="kpi-month-select-trigger" aria-label="Viewing month"><SelectValue /></SelectTrigger><SelectContent>{monthOptions.map((month) => <SelectItem key={month} value={month}>{getMonthLabel(month)}{monthlyData[month]?.demo ? " · Demo" : ""}</SelectItem>)}</SelectContent></Select></label></div>
        <div className="kpi-new-month-container">
          {canEdit && <label className="kpi-new-month"><span>{creatingMonth ? "Creating month…" : "New month"}</span><input type="month" value={monthDraft} disabled={creatingMonth} onChange={(event) => { setMonthDraft(event.target.value); void createMonth(event.target.value); }} aria-label="Create or open month" /></label>}
          {canEdit && Object.keys(records).length > 0 && <Button type="button" variant="outline" className="kpi-reset-month-trigger" disabled={resettingMonth} onClick={() => setShowResetConfirm(true)}><RotateCcw size={14} />{resettingMonth ? "Resetting…" : "Reset month"}</Button>}
        </div>
        {isDemo && <span className="kpi-demo-pill"><Sparkles size={13} /> Demo data · replace with your monthly scores</span>}
        {!isDemo && <span className="kpi-saved-indicator"><span /> {isSupabaseConfigured ? "Published results" : "Saved in this browser"}</span>}
      </div>

      {syncError && <div className="kpi-form-error" role="alert">{syncError}</div>}{syncMessage && <p className="auth-success" role="status">{syncMessage}</p>}
      {isSupabaseConfigured && !remoteReady && <div className="kpi-empty-state"><BarChart3 size={22} /><strong>Loading monthly results…</strong></div>}

      <section className="kpi-trend-panel">
        <div className="kpi-section-head"><div><p className="kpi-overline">LONG-TERM PROGRESS</p><h2>Performance trend</h2><p>Follow saved monthly results, including historical records.</p></div><div className="kpi-chart-controls"><select value={trendMetric} onChange={(event) => { const mode = event.target.value; setTrendMetric(mode); if (mode === "rank" && trendTarget === "team") setTrendTarget(peopleWithHistory[0]?.id ?? "team"); }} aria-label="Trend metric"><option value="overall">KPI score</option><option value="rank">Imported rank</option>{KPI_METRICS.map((metric) => <option value={metric.id} key={metric.id}>{metric.label}{metric.isPercent ? " · percent" : " · raw count"}</option>)}</select><select value={trendTarget} onChange={(event) => setTrendTarget(event.target.value)} aria-label="Trend subject"><option value="team" disabled={trendMetric === "rank"}>Team average</option>{peopleWithHistory.map((member) => <option value={member.id} key={member.id}>{member.name}{member.historical ? " · former" : ""}</option>)}</select><div className="kpi-range-toggle">{TREND_RANGES.map((item) => <button type="button" className={range === item ? "active" : ""} key={item} onClick={() => setRange(item)}>{item} mo</button>)}</div></div></div>
        <div className="kpi-chart-summary"><span className="kpi-chart-legend"><i />{trendTarget === "team" ? "Average across saved monthly rows" : peopleWithHistory.find((member) => member.id === trendTarget)?.name}<small>·</small><span className="kpi-target-key">{trendMetric === "rank" ? "Imported rank · lower is better" : trendMetric === "overall" || trendMetric === "qa" ? "Dashed line · target" : "Imported raw values"}</span></span><span>Through {getMonthLabel(selectedMonth)}</span></div>
        <VisibleChartRegion label="performance-trend" onVisible={() => setTrendVisible(true)}><Suspense fallback={<div className="kpi-chart-empty">Loading performance chart…</div>}><TrendChart months={trendMonths} monthlyData={monthlyData} people={peopleWithHistory} metricMode={trendMetric} range={range} targetId={trendTarget} selectedMonth={selectedMonth} getRecordScore={getRecordScore} settingsOf={settingsOf} /></Suspense></VisibleChartRegion>
      </section>

      <VisibleChartRegion label="monthly-insights"><Suspense fallback={<div className="kpi-insights-grid"><div className="kpi-insight-loading">Loading monthly insights…</div></div>}><KpiInsightsCharts monthlyData={monthlyData} selectedMonth={selectedMonth} people={peopleWithHistory} getRecordScore={getRecordScore} settingsOf={settingsOf} availableMonths={monthOptions} onHistoryYearChange={requestHistoryYear} /></Suspense></VisibleChartRegion>

      <div className="kpi-summary-grid">
        <article className="kpi-summary-card"><span className="kpi-summary-icon"><BarChart3 size={17} /></span><div><small>TEAM KPI AVERAGE</small><strong>{rankedTeam ? formatScore(teamAverage) : "—"}<em>/ {selectedMaximum.toFixed(2)}</em></strong><span>{getEvaluation(teamAverage, selectedScoringSettings)}</span></div></article>
        <article className="kpi-summary-card"><span className="kpi-summary-icon"><Target size={17} /></span><div><small>AVERAGE QA SCORE</small><strong>{rankedTeam ? `${formatScore(averageQa, 2)}%` : "—"}</strong><span>Across {rankedTeam} team members</span></div></article>
        <article className="kpi-summary-card kpi-top-summary"><span className="kpi-summary-icon"><Trophy size={17} /></span><div><small>MONTH LEADER</small><strong>{topPerformer?.member.name ?? "No results yet"}</strong><span>{topPerformer ? `${formatScore(topPerformer.score)} KPI · rank #1` : "Enter or import results"}</span></div></article>
        <article className="kpi-summary-card"><span className="kpi-summary-icon"><Medal size={17} /></span><div><small>RESULTS ENTERED</small><strong>{rankedTeam}</strong><span>Saved monthly rows for {getMonthLabel(selectedMonth)}</span></div></article>
      </div>

      <section className="kpi-comparison-panel">
        <div className="kpi-section-head kpi-comparison-head"><div><p className="kpi-overline">EVERYONE AT A GLANCE</p><h2>Team comparison</h2><p>See all team members on the same scale. Select a person for their full scorecard.</p></div><div className="kpi-comparison-controls"><label className="kpi-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a person" /></label><select value={compareMetric} onChange={(event) => setCompareMetric(event.target.value)} aria-label="Comparison metric"><option value="overall">Overall KPI</option>{KPI_METRICS.map((metric) => <option value={metric.id} key={metric.id}>{metric.label} · {metric.isPercent ? "percent" : "equivalent"}</option>)}</select><Button variant="outline" onClick={() => setCompareOpen((open) => !open)}>{compareOpen ? "Close compare" : "Compare"}</Button></div></div>
        {leaderboard.length ? <div className="kpi-team-bars">{[...filteredLeaderboard].sort((a, b) => {
          const aValue = compareMetric === "overall" ? a.score : getMetricValue(a.record, compareMetric, compareMetric === "qa" ? "rawValue" : "equivalentScore");
          const bValue = compareMetric === "overall" ? b.score : getMetricValue(b.record, compareMetric, compareMetric === "qa" ? "rawValue" : "equivalentScore");
          return bValue - aValue;
        }).map((row, index) => {
          const value = compareMetric === "overall" ? row.score : getMetricValue(row.record, compareMetric, compareMetric === "qa" ? "rawValue" : "equivalentScore");
          const max = compareMetric === "overall" ? Math.max(selectedMaximum, ...leaderboard.map((entry) => getMaximumKpiScore(settingsOf(entry.record)))) : compareMetric === "qa" ? 100 : 5;
          const prior = getPreviousRow(row.member.id);
          const delta = prior ? value - getMetricValue(prior.record, compareMetric, compareMetric === "qa" ? "rawValue" : "equivalentScore") : null;
          return <button className="kpi-team-bar-row" type="button" key={row.member.id} onClick={() => setDetailMemberId(row.member.id)}><span className="kpi-bar-rank">{String(index + 1).padStart(2, "0")}</span><MemberAvatar member={row.member} /><span className="kpi-bar-name"><strong>{row.member.name}</strong><small>{row.member.role}</small></span><span className="kpi-bar-track"><i style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} /></span><strong className="kpi-bar-value">{compareMetric === "qa" ? `${formatScore(value, 2)}%` : formatScore(value)}</strong><span className={`kpi-bar-delta ${delta == null ? "" : delta >= 0 ? "kpi-positive" : "kpi-negative"}`}>{delta == null ? "New" : <>{delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{delta >= 0 ? "+" : ""}{compareMetric === "qa" ? `${formatScore(delta, 2)}%` : formatScore(delta)}</>}</span></button>;
        })}</div> : <div className="kpi-empty-state"><BarChart3 size={22} /><strong>No monthly results yet</strong><span>Enter scores or import your monthly file to populate the dashboard.</span><div><Button variant="outline" onClick={() => setShowImporter(true)}><Upload size={14} /> Import results</Button><Button onClick={openAddResult}><Plus size={14} /> Enter first result</Button></div></div>}
        {compareOpen && <div className="kpi-compare-drawer"><div className="kpi-compare-drawer-head"><div><p className="kpi-overline">HEAD-TO-HEAD</p><h3>Compare performance</h3></div><div className="kpi-compare-pickers"><label><span>Person</span><select value={comparePrimary} onChange={(event) => setComparisonSubject(event.target.value)}>{scoreboardMembers.map((member) => <option key={member.id} value={member.id}>{member.name}{member.historical ? " (former)" : ""}</option>)}</select></label><label><span>Against</span><select value={compareMode} onChange={(event) => setCompareMode(event.target.value)}><option value="previous">Previous month</option><option value="person">Another person</option></select></label>{compareMode === "person" && <label><span>Team member</span><select value={compareOtherMember} onChange={(event) => setComparisonPeer(event.target.value)}>{scoreboardMembers.filter((member) => member.id !== comparePrimary).map((member) => <option key={member.id} value={member.id}>{member.name}{member.historical ? " (former)" : ""}</option>)}</select></label>}</div></div><div className="kpi-head-to-head-labels"><span>{scoreboardMembers.find((member) => member.id === comparePrimary)?.name ?? "Person"}</span><span>{compareMode === "previous" ? getMonthLabel(previousMonth) : scoreboardMembers.find((member) => member.id === compareOtherMember)?.name ?? "Person"}</span></div><div className="kpi-head-to-head"><div className="kpi-head-to-head-row"><span>Overall KPI</span><div><i className="kpi-bar-first" style={{ width: `${getMaximumKpiScore(settingsOf(comparePrimaryRecord)) ? (getRecordScore(comparePrimaryRecord, settingsOf(comparePrimaryRecord)) / getMaximumKpiScore(settingsOf(comparePrimaryRecord))) * 100 : 0}%` }} /><i className="kpi-bar-second" style={{ width: `${getMaximumKpiScore(settingsOf(compareSecondMonth)) ? (getRecordScore(compareSecondMonth, settingsOf(compareSecondMonth)) / getMaximumKpiScore(settingsOf(compareSecondMonth))) * 100 : 0}%` }} /></div><strong>{formatScore(getRecordScore(comparePrimaryRecord, settingsOf(comparePrimaryRecord)))} <small>·</small> {formatScore(getRecordScore(compareSecondMonth, settingsOf(compareSecondMonth)))}</strong></div>{KPI_METRICS.map((metric) => { const a = getMetricValue(comparePrimaryRecord, metric.id); const b = getMetricValue(compareSecondMonth, metric.id); return <div className="kpi-head-to-head-row" key={metric.id}><span>{metric.shortLabel}</span><div><i className="kpi-bar-first" style={{ width: `${(a / 5) * 100}%` }} /><i className="kpi-bar-second" style={{ width: `${(b / 5) * 100}%` }} /></div><strong>{formatScore(a)} <small>·</small> {formatScore(b)}</strong></div>; })}</div><p className="kpi-compare-footnote">Bars show equivalent score out of 5. Overall KPI bars use each month’s saved scoring scale.</p></div>}
      </section>

      <section className="kpi-leaderboard-section">
        <div className="kpi-section-head"><div><p className="kpi-overline">MONTHLY RANKINGS</p><h2>Leaderboard</h2><p>Scores, rank movement and milestones for {getMonthLabel(selectedMonth)}.</p></div><span className="kpi-leaderboard-season"><Trophy size={14} /> Season · {getMonthLabel(selectedMonth)}</span></div>
        {leaderboard.length > 0 && <div className="kpi-podium-grid">{[leaderboard[1], leaderboard[0], leaderboard[2]].filter(Boolean).map((row) => {
          const previous = getPreviousRow(row.member.id);
          const movement = getRankMovement(row.member.id, row.rank);
          const progress = getTierProgress(row.score, settingsOf(row.record));
          const badges = getBadges(row, previous, resolvedRecordsByMonth, row.member.id, selectedMonth);
          return <button className={`kpi-podium-card kpi-podium-${row.rank}`} type="button" key={row.member.id} onClick={() => setDetailMemberId(row.member.id)} aria-label={`${row.rankLabel} place, ${row.member.name}, ${formatScore(row.score)} KPI score`}>
            <span className="kpi-podium-effects" aria-hidden="true">{Array.from({ length: row.rank === 1 ? 7 : 4 }, (_, index) => <i key={index} />)}</span>
            <span className="kpi-podium-place">{row.rank === 1 ? <Crown size={18} /> : row.rank === 2 ? <Medal size={17} /> : <Award size={17} />}<b>#{row.rankLabel}</b></span>
            <span className="kpi-podium-avatar-frame"><MemberAvatar member={row.member} large />{row.rank === 1 && <span className="kpi-podium-crown"><Crown size={12} fill="currentColor" /></span>}</span>
            <strong className="kpi-podium-name">{row.member.name}</strong><span className="kpi-podium-role">{row.member.role}</span>
            <b className="kpi-podium-score">{formatScore(row.score)}<small> / {getMaximumKpiScore(settingsOf(row.record)).toFixed(2)}</small></b><span className="kpi-podium-evaluation">{getRecordEvaluation(row.record, row.score, settingsOf(row.record))}</span>
            <span className="kpi-podium-tier"><span>{progress.label} · {Math.round(progress.percent)}%</span><i><em style={{ width: `${progress.percent}%` }} /></i></span>
            <span className={`kpi-podium-movement ${movement == null ? "" : movement > 0 ? "kpi-positive" : movement < 0 ? "kpi-negative" : ""}`}>{movement == null ? "New this month" : movement > 0 ? `↑ ${movement} place${movement === 1 ? "" : "s"}` : movement < 0 ? `↓ ${Math.abs(movement)} place${movement === -1 ? "" : "s"}` : "— Same rank"}</span>
            <div className="kpi-badge-list">{badges.map(({ label, icon: Icon }) => <span className="kpi-achievement-badge" key={label}><Icon size={11} />{label}</span>)}</div><span className="kpi-podium-base">{row.rank === 1 ? "MONTH MVP" : `RANK ${row.rankLabel}`}</span>
          </button>;
        })}</div>}
        {leaderboard.length > 3 && <div className="kpi-ranking-list">{leaderboard.slice(3).map((row) => {
          const prior = getPreviousRow(row.member.id);
          const movement = getRankMovement(row.member.id, row.rank);
          const progress = getTierProgress(row.score, settingsOf(row.record));
          const badges = getBadges(row, prior, resolvedRecordsByMonth, row.member.id, selectedMonth);
          return <button type="button" className="kpi-ranking-row" key={row.member.id} onClick={() => setDetailMemberId(row.member.id)}><span className="kpi-ranking-number">#{row.rankLabel}</span><MemberAvatar member={row.member} /><span className="kpi-ranking-person"><strong>{row.member.name}</strong><small>{row.member.role}</small></span><span className="kpi-tier-progress"><span><small>{progress.label}</small><b>{Math.round(progress.percent)}%</b></span><i><em style={{ width: `${progress.percent}%` }} /></i></span><span className="kpi-ranking-badges">{badges.map(({ label, icon: Icon }) => <span className="kpi-achievement-badge" key={label}><Icon size={11} />{label}</span>)}</span><span className={`kpi-rank-change ${movement == null ? "" : movement > 0 ? "kpi-positive" : movement < 0 ? "kpi-negative" : ""}`}>{movement == null ? "NEW" : movement > 0 ? <><ArrowUpRight size={14} />{movement} up</> : movement < 0 ? <><ArrowDownRight size={14} />{Math.abs(movement)} down</> : "—"}</span><strong className="kpi-ranking-score">{formatScore(row.score)}</strong></button>;
        })}</div>}
        {!leaderboard.length && <div className="kpi-empty-state kpi-empty-compact"><Trophy size={22} /><strong>Rankings appear after scores are entered</strong><span>Complete a monthly result for your team to generate the leaderboard.</span></div>}
      </section>

      <section className="kpi-roster-card"><div className="kpi-roster-heading"><div><p className="kpi-overline">MONTHLY SCORECARDS</p><h2>Team results</h2><p>Open a profile for detailed metric scores, or edit that month’s results.</p></div><Button variant="outline" onClick={openAddResult}><Plus size={15} /> Add / edit result</Button></div><div className="kpi-member-card-grid">{scoreboardMembers.map((member) => {
        const record = currentResolvedRecords[member.id] ?? records[member.id];
        const row = leaderboard.find((item) => item.member.id === member.id);
        const previous = getPreviousRow(member.id);
        const delta = record && previous ? getRecordScore(record, settingsOf(record)) - getRecordScore(previous.record, settingsOf(previous.record)) : null;
        return <article className={`kpi-member-card ${!record ? "kpi-member-card-empty" : ""}`} key={member.id}><button className="kpi-member-card-main" type="button" onClick={() => record && setDetailMemberId(member.id)} disabled={!record}><span className="kpi-member-card-top"><MemberAvatar member={member} /><span className="kpi-member-card-rank">{row ? `#${row.rankLabel}` : "—"}</span></span><strong>{member.name}</strong><small>{member.role}{member.historical ? " ? Former roster" : ""}</small><span className="kpi-member-card-score">{record ? formatScore(getRecordScore(record, settingsOf(record))) : "No result"}<em>{record ? `/ ${getMaximumKpiScore(settingsOf(record)).toFixed(2)}` : ""}</em></span><span className="kpi-member-card-evaluation">{record ? getRecordEvaluation(record, getRecordScore(record, settingsOf(record)), settingsOf(record)) : "Add this month’s scores"}</span><span className={`kpi-member-card-delta ${delta == null ? "" : delta >= 0 ? "kpi-positive" : "kpi-negative"}`}>{delta == null ? "No previous month" : `${delta >= 0 ? "+" : ""}${formatScore(delta)} vs last month`}</span></button>{canEdit && !member.historical && <button className="kpi-card-edit" type="button" onClick={() => setEditingMemberId(member.id)}>{record ? "Edit" : "Enter score"}</button>}</article>;
      })}</div></section>

      {selectedMember && selectedRecord && <MemberDetailDialog member={selectedMember} record={selectedRecord} previousRecord={previousRecords[selectedMember.id]} teamAverage={teamAverage} canEdit={canEdit && !selectedMember?.historical} onClose={() => setDetailMemberId(null)} onEdit={() => { setEditingMemberId(selectedMember.id); setDetailMemberId(null); }} />}
      {canEdit && editingMemberId && <ScoreEditorDialog key={`${selectedMonth}-${editingMemberId}`} teamMembers={teamMembers} initialMemberId={editingMemberId} initialRecord={currentResolvedRecords[editingMemberId] ?? records[editingMemberId] ?? null} scoringSettings={selectedScoringSettings} onClose={() => setEditingMemberId(null)} onSave={saveRecord} />}
      {canEdit && showImporter && <ImportDialog teamMembers={teamMembers} selectedMonth={selectedMonth} onClose={() => setShowImporter(false)} onImport={importRecords} />}
      {canEdit && showResetConfirm && <div className="kpi-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !resettingMonth) setShowResetConfirm(false); }}>
        <section className="kpi-import-dialog kpi-reset-confirm" role="alertdialog" aria-modal="true" aria-labelledby="kpi-reset-title" aria-describedby="kpi-reset-description">
          <div className="kpi-dialog-heading"><div><p className="kpi-overline">RESET MONTHLY RESULTS</p><h2 id="kpi-reset-title">Reset {getMonthLabel(selectedMonth)}?</h2><span id="kpi-reset-description">This removes {Object.keys(records).length} result{Object.keys(records).length === 1 ? "" : "s"} from the active monthly scoreboard and dashboard views. The month and scoring settings remain.</span></div><Button type="button" variant="ghost" size="icon" onClick={() => setShowResetConfirm(false)} disabled={resettingMonth} aria-label="Close reset confirmation"><X size={18} /></Button></div>
          <p className="kpi-reset-recovery-note">The previous results are saved in History and can be restored for 30 days.</p>
          <div className="kpi-dialog-actions"><Button type="button" variant="outline" onClick={() => setShowResetConfirm(false)} disabled={resettingMonth}>Cancel</Button><Button type="button" className="kpi-reset-confirm-button" onClick={() => void resetSelectedMonth()} disabled={resettingMonth}><RotateCcw size={14} />{resettingMonth ? "Resetting…" : "Reset this month"}</Button></div>
        </section>
      </div>}
    </section>
  );
}
