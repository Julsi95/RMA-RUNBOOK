import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpWideNarrow, Check, RotateCcw, Save, Scale, SlidersHorizontal, Target } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import {
  DEFAULT_KPI_SCORING_SETTINGS, getKpiScoringSettings, KPI_METRICS, KPI_SCORING_SETTINGS_KEY,
} from "@/features/kpi/kpi-data";
import { isSupabaseConfigured } from "@/lib/supabase";
import { loadCurrentKpiScoring, saveCurrentKpiScoring } from "@/lib/backend-repositories";
import { retryDataLoad, subscribeToTables } from "@/lib/backend/shared";
import "@/features/kpi/kpi-qa.css";

const BAND_HINTS = {
  Outstanding: "Top performance",
  "Above Average": "Strong performance",
  "On Track": "Meets expectations",
  "Needs Focus": "Below expectations",
};

function numberValue(value) {
  if (value === "" || value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function KpiScoringSettingsPage() {
  const [draft, setDraft] = useState(() => structuredClone(getKpiScoringSettings()));
  const [message, setMessage] = useState("");
  const [remoteReady, setRemoteReady] = useState(!isSupabaseConfigured);
  const [remoteLoading, setRemoteLoading] = useState(isSupabaseConfigured);
  const [saving, setSaving] = useState(false);
  const draftRef = useRef(draft);
  const savedSnapshotRef = useRef(JSON.stringify(draft));
  const savingRef = useRef(false);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { savingRef.current = saving; }, [saving]);
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    const refresh = async () => {
      setRemoteLoading(true);
      try {
        const current = await retryDataLoad(loadCurrentKpiScoring);
        if (!active) return;
        if (current?.settings) {
          const remoteSnapshot = JSON.stringify(current.settings);
          if (!savingRef.current && JSON.stringify(draftRef.current) === savedSnapshotRef.current) {
            localStorage.setItem(KPI_SCORING_SETTINGS_KEY, remoteSnapshot);
            savedSnapshotRef.current = remoteSnapshot;
            setDraft(structuredClone(current.settings));
            setMessage(`Current saved rule version · ${current.versionNumber ?? "active"}`);
          } else if (remoteSnapshot !== savedSnapshotRef.current) {
            savedSnapshotRef.current = remoteSnapshot;
            setMessage("New scoring settings were saved elsewhere. Your unsaved edits are still here; reload to review the latest version.");
          }
        }
        setRemoteReady(true);
      } catch (error) {
        if (active) setMessage(error.message || "Could not load saved scoring settings. Check your connection and retry.");
      } finally { if (active) setRemoteLoading(false); }
    };
    void refresh();
    const unsubscribe = subscribeToTables(["current_kpi_scoring", "kpi_scoring_versions"], refresh, "kpi-scoring-settings");
    return () => { active = false; unsubscribe(); };
  }, []);
  const totalWeight = useMemo(() => KPI_METRICS.reduce((sum, metric) => sum + numberValue(draft.metrics[metric.id].weightPercent), 0), [draft]);
  const maxScore = totalWeight / 100 * 5;
  const weightDifference = totalWeight - 100;
  const configuredFormulas = KPI_METRICS.filter((metric) => draft.metrics[metric.id].mode === "formula").length;

  function updateMetric(metricId, field, value) {
    setMessage("");
    setDraft((current) => ({ ...current, metrics: { ...current.metrics, [metricId]: { ...current.metrics[metricId], [field]: value } } }));
  }

  function updateBand(index, field, value) {
    setMessage("");
    setDraft((current) => ({ ...current, evaluationBands: current.evaluationBands.map((band, bandIndex) => bandIndex === index ? { ...band, [field]: value } : band) }));
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (isSupabaseConfigured && !remoteReady) {
      setMessage("Saved scoring settings could not be loaded. Reload the page before saving to avoid replacing them.");
      return;
    }
    const missingFormula = KPI_METRICS.find((metric) => {
      const rule = draft.metrics[metric.id];
      if (rule.mode !== "formula") return false;
      const five = Number(rule.scoreFiveAt);
      const zero = Number(rule.scoreZeroAt);
      return rule.scoreFiveAt === "" || rule.scoreZeroAt === "" || !Number.isFinite(five) || !Number.isFinite(zero)
        || rule.direction === "higher" && five <= zero
        || rule.direction === "lower" && five >= zero;
    });
    if (missingFormula) {
      setMessage(`Check ${missingFormula.label} formula anchors: the 5-point value must be higher for higher-is-better, and lower for lower-is-better.`);
      return;
    }
    if (totalWeight <= 0) {
      setMessage("The total metric weight must be greater than 0%.");
      return;
    }
    if (draft.evaluationBands.some((band) => !String(band.label).trim() || band.min === "" || !Number.isFinite(Number(band.min)))) {
      setMessage("Give each evaluation band a name and a valid minimum score.");
      return;
    }
    if (new Set(draft.evaluationBands.map((band) => Number(band.min))).size !== draft.evaluationBands.length) {
      setMessage("Give each evaluation band a different minimum score.");
      return;
    }
    if (draft.evaluationBands.some((band) => Number(band.min) < 0 || Number(band.min) > maxScore)) {
      setMessage(`Evaluation minimum scores must be between 0 and the current maximum (${maxScore.toFixed(2)}).`);
      return;
    }
    const savedSettings = {
      metrics: Object.fromEntries(KPI_METRICS.map((metric) => {
        const rule = draft.metrics[metric.id];
        return [metric.id, { ...rule, weightPercent: numberValue(rule.weightPercent), scoreFiveAt: rule.scoreFiveAt === "" ? "" : Number(rule.scoreFiveAt), scoreZeroAt: rule.scoreZeroAt === "" ? "" : Number(rule.scoreZeroAt) }];
      })),
      evaluationBands: draft.evaluationBands.map((band) => ({ label: String(band.label).trim(), min: Number(band.min) })),
    };
    setSaving(true);
    try {
      const versionId = isSupabaseConfigured ? await saveCurrentKpiScoring(savedSettings) : null;
      localStorage.setItem(KPI_SCORING_SETTINGS_KEY, JSON.stringify(savedSettings));
      savedSnapshotRef.current = JSON.stringify(savedSettings);
      setDraft(savedSettings);
      setMessage(isSupabaseConfigured ? `Saved as a new scoring version${versionId ? ` · ${String(versionId).slice(0, 8)}` : ""}. Past months keep their saved rules.` : "Scoring settings saved in this browser.");
    } catch (error) {
      setMessage(error.message || "Could not save scoring settings.");
    } finally { setSaving(false); }
  }

  function resetDraft() {
    setDraft(structuredClone(DEFAULT_KPI_SCORING_SETTINGS));
    setMessage("Defaults loaded. Save to apply them.");
  }

  function renderMetricCard(metric) {
    const rule = draft.metrics[metric.id];
    const formulaReady = rule.scoreFiveAt !== "" && rule.scoreZeroAt !== "" && Number(rule.scoreFiveAt) !== Number(rule.scoreZeroAt);
    return (
      <article className="kpi-settings-metric-card" key={metric.id}>
        <div className="kpi-settings-metric-top"><div><span className="kpi-settings-metric-dot">{metric.shortLabel.slice(0, 2).toUpperCase()}</span><div><h3>{metric.label}</h3><p>{metric.valueLabel} · score out of 5</p></div></div><label className="kpi-weight-field"><span>Weight</span><div><input type="number" min="0" max="100" step="0.1" value={rule.weightPercent} onChange={(event) => updateMetric(metric.id, "weightPercent", event.target.value)} /><b>%</b></div></label></div>
        <div className="kpi-settings-rule-row"><label><span>Scoring method</span><Select value={rule.mode} onValueChange={(value) => updateMetric(metric.id, "mode", value)}><SelectTrigger aria-label={`${metric.label} scoring method`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual">Enter equivalent score manually</SelectItem><SelectItem value="formula">Calculate from raw value</SelectItem></SelectContent></Select></label><p>{rule.mode === "manual" ? "Monthly entry and imports provide the equivalent score. Weighted score is calculated from your weight." : "The raw value is converted to a score from 0 to 5 using the anchors below."}</p></div>
        {rule.mode === "formula" && <div className="kpi-settings-formula"><label><span>Direction</span><Select value={rule.direction} onValueChange={(value) => updateMetric(metric.id, "direction", value)}><SelectTrigger aria-label={`${metric.label} scoring direction`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="higher"><span className="kpi-select-option-icon"><ArrowUpWideNarrow size={14} /> Higher is better</span></SelectItem><SelectItem value="lower"><span className="kpi-select-option-icon"><ArrowDownWideNarrow size={14} /> Lower is better</span></SelectItem></SelectContent></Select></label><label><span>Raw value that earns 5 / 5</span><input type="number" step="any" value={rule.scoreFiveAt} onChange={(event) => updateMetric(metric.id, "scoreFiveAt", event.target.value)} placeholder={metric.isPercent ? "e.g. 98" : "Set your target"} /></label><label><span>Raw value that earns 0 / 5</span><input type="number" step="any" value={rule.scoreZeroAt} onChange={(event) => updateMetric(metric.id, "scoreZeroAt", event.target.value)} placeholder="Set your lower boundary" /></label><div className={`kpi-formula-status ${formulaReady ? "is-ready" : ""}`}>{formulaReady ? "Formula anchors ready" : "Set two different anchor values to activate this rule."}</div></div>}
      </article>
    );
  }

  return (
    <section className="page-content kpi-settings-page">
      <div className="page-heading kpi-settings-heading">
        <div><p className="eyebrow">ADMIN · PERFORMANCE</p><h1>KPI scoring settings</h1><p className="page-description">Set how monthly results are scored, weighted, and evaluated.</p></div>
        <Button form="kpi-scoring-settings-form" type="submit" disabled={remoteLoading || saving}><Save size={15} /> Save settings</Button>
      </div>

      <div className="kpi-settings-summary">
        <article><span className="kpi-settings-summary-icon"><Scale size={17} /></span><div><small>TOTAL WEIGHT</small><strong>{totalWeight.toFixed(1)}%</strong><span className={Math.abs(weightDifference) < 0.05 ? "kpi-settings-good" : "kpi-settings-note"}>{Math.abs(weightDifference) < 0.05 ? "Balanced to 100%" : `${Math.abs(weightDifference).toFixed(1)}% ${weightDifference > 0 ? "over" : "below"} 100%`}</span></div></article>
        <article><span className="kpi-settings-summary-icon"><Target size={17} /></span><div><small>MAX KPI SCORE</small><strong>{maxScore.toFixed(2)}</strong><span>Based on configured weights</span></div></article>
        <article><span className="kpi-settings-summary-icon"><SlidersHorizontal size={17} /></span><div><small>AUTO SCORING RULES</small><strong>{configuredFormulas} / {KPI_METRICS.length}</strong><span>Metrics using raw-value formulas</span></div></article>
      </div>

      <form id="kpi-scoring-settings-form" onSubmit={saveSettings} className="kpi-settings-form">
        {remoteLoading && <p className="kpi-settings-band-note">Loading the current saved scoring version…</p>}
        <section className="kpi-settings-section">
          <div className="kpi-settings-section-head"><div><p className="kpi-overline">01 · METRIC RULES</p><h2>Weights and score conversion</h2><p>Weights control each metric’s share of the total. Choose manual equivalent scores or configure an automatic raw-value formula.</p></div><Button type="button" variant="outline" onClick={resetDraft}><RotateCcw size={14} /> Reset draft</Button></div>
          <div className="kpi-settings-metric-layout">
            <div className="kpi-settings-metric-columns" aria-label="Metric scoring rules">
              {[KPI_METRICS.filter((_, index) => index % 2 === 0), KPI_METRICS.filter((_, index) => index % 2 === 1)].map((column, index) => <div className="kpi-settings-metric-column" key={index}>{column.map(renderMetricCard)}</div>)}
            </div>
            <div className="kpi-settings-metric-mobile">{KPI_METRICS.map(renderMetricCard)}</div>
          </div>
          <div className="kpi-settings-formula-note"><strong>Formula behavior</strong><span>Between the two anchors, the app calculates a linear score. Values beyond the anchors are capped at 0 or 5. For higher-is-better, the 5-point anchor should be larger than the 0-point anchor; reverse that for lower-is-better.</span></div>
        </section>

        <section className="kpi-settings-section">
          <div className="kpi-settings-section-head"><div><p className="kpi-overline">02 · EVALUATION LABELS</p><h2>Performance bands</h2><p>These labels appear on scorecards and rankings based on each person’s total weighted score.</p></div><span className="kpi-settings-scale">Maximum score · {maxScore.toFixed(2)}</span></div>
          <div className="kpi-settings-bands">
            {draft.evaluationBands.map((band, index) => <article className="kpi-settings-band" key={`${index}-${band.label}`}><span className={`kpi-band-index kpi-band-index-${index}`}>{String(index + 1).padStart(2, "0")}</span><label><span>Band name</span><input value={band.label} onChange={(event) => updateBand(index, "label", event.target.value)} /></label><label><span>Minimum score</span><input type="number" min="0" step="0.01" value={band.min} onChange={(event) => updateBand(index, "min", event.target.value)} /></label><small>{BAND_HINTS[band.label] ?? "Custom evaluation"}</small></article>)}
          </div>
          <p className="kpi-settings-band-note">The app checks the highest minimum score first. Make each band’s minimum distinct so evaluation labels are predictable.</p>
        </section>

        <div className="kpi-settings-footer"><div><span className="kpi-settings-save-icon"><Check size={15} /></span><span>{message || (isSupabaseConfigured ? "Saving creates a new version. Existing months keep their pinned scoring rules." : "Changes apply to KPI results in this browser after saving.")}</span></div><Button type="submit" disabled={remoteLoading || saving || (isSupabaseConfigured && !remoteReady)}><Save size={15} /> {saving ? "Saving…" : "Save settings"}</Button></div>
      </form>
    </section>
  );
}
