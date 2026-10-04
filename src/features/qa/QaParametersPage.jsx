import { useMemo, useState } from "react";
import { ArrowDownWideNarrow, Check, ClipboardCheck, Pencil, Plus, Search, SlidersHorizontal, Target, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import "@/features/qa/qa-parameters.css";

const STORAGE_KEY = "starter-app-qa-parameters-v1";
const SAMPLE_CRITERIA = [
  ["Greeting & discovery", "Agent opened the call promptly and used the proper opening script.", 14, 14],
  ["Case handling", "Agent opened or created the MRA case template and filled it out accurately.", 14, 14],
  ["Greeting & discovery", "Agent asked relevant and targeted probing questions.", 14, 14],
  ["Communication", "Agent answered all questions thoroughly and with confidence.", 14, 14],
  ["Communication", "Agent provided support according to customer needs and educated the customer when needed.", 14, 13],
  ["Communication", "Agent exhibited understanding of what the customer really wanted.", 14, 13],
  ["Case handling", "Agent correctly determined which case scenario the customer’s request falls in.", 14, 14],
  ["Case handling", "Agent was familiar with the call scenario and knew which procedure to follow to address the customer’s concern.", 14, 14],
  ["Customer experience", "Agent provided satisfactory service and met or exceeded the customer’s expectations.", 14, 14],
  ["Customer experience", "Agent handled the call in an efficient and timely manner.", 14, 14],
  ["Procedure", "Agent followed the proper hold procedure.", 14, 14],
  ["Communication", "Agent spoke clearly, understandably, and at a pace appropriate for the customer.", 14, 14],
  ["Documentation", "Agent used proper grammar when documenting the case and was mindful of spelling and punctuation, using acceptable shortcuts and abbreviations.", 14, 14],
  ["Professionalism", "Agent remained professional.", 14, 14],
  ["Professionalism", "Agent used the proper closing spiel.", 14, 14],
  ["Case handling", "Agent provided the correct case number when applicable.", 14, 14],
  ["Procedure", "Agent disposed of the call in a timely manner.", 14, 14],
].map(([category, criterion, tcr, tcp], index) => ({ id: "qa-sample-" + (index + 1), category, criterion, tcr, tcp, order: index }));

function readCriteria() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return SAMPLE_CRITERIA;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : SAMPLE_CRITERIA;
  } catch {
    return SAMPLE_CRITERIA;
  }
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? "qa-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function scoreOf(item) {
  const total = Number(item.tcr);
  return total > 0 ? Math.round((Number(item.tcp) / total) * 10000) / 100 : null;
}

function percentLabel(value) {
  return value === null ? "No data" : value.toFixed(2) + "%";
}

export default function QaParametersPage() {
  const [criteria, setCriteria] = useState(readCriteria);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [sort, setSort] = useState("custom");
  const [editor, setEditor] = useState(null);
  const categories = useMemo(() => [...new Set(criteria.map((item) => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [criteria]);
  const totals = useMemo(() => criteria.reduce((sum, item) => ({ tcr: sum.tcr + Number(item.tcr), tcp: sum.tcp + Number(item.tcp) }), { tcr: 0, tcp: 0 }), [criteria]);
  const overall = totals.tcr > 0 ? Math.round((totals.tcp / totals.tcr) * 10000) / 100 : null;
  const reviewedCriteria = criteria.filter((item) => Number(item.tcr) > 0).length;
  const filteredCriteria = criteria.filter((item) => {
    const matchesCategory = activeCategory === "All" || item.category === activeCategory;
    const text = (item.criterion + " " + item.category).toLowerCase();
    return matchesCategory && text.includes(query.trim().toLowerCase());
  }).sort((a, b) => {
    if (sort === "low") return (scoreOf(a) ?? 101) - (scoreOf(b) ?? 101);
    if (sort === "high") return (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1);
    return Number(a.order ?? 0) - Number(b.order ?? 0);
  });

  function persist(next) {
    setCriteria(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* keep this session's edits */ }
  }

  function openEditor(item = null) {
    setEditor(item
      ? { ...item, tcr: String(item.tcr), tcp: String(item.tcp) }
      : { id: "", category: activeCategory === "All" ? "Customer experience" : activeCategory, criterion: "", tcr: "14", tcp: "14" });
  }

  function saveCriterion(event) {
    event.preventDefault();
    const tcr = Number(editor.tcr);
    const tcp = Number(editor.tcp);
    if (!editor.criterion.trim() || !editor.category.trim() || !Number.isInteger(tcr) || !Number.isInteger(tcp) || tcr < 0 || tcp < 0 || tcp > tcr) return;
    const existing = criteria.find((item) => item.id === editor.id);
    const nextItem = { ...editor, id: editor.id || makeId(), criterion: editor.criterion.trim(), category: editor.category.trim(), tcr, tcp, order: existing?.order ?? criteria.length };
    persist(existing ? criteria.map((item) => item.id === existing.id ? nextItem : item) : [...criteria, nextItem]);
    setActiveCategory(nextItem.category);
    setEditor(null);
  }

  function deleteCriterion(id) {
    const next = criteria.filter((item) => item.id !== id).map((item, index) => ({ ...item, order: index }));
    persist(next);
  }

  return <section className="page-content qa-parameters-page">
    <header className="page-heading qa-parameters-heading">
      <div><p className="eyebrow">QUALITY · ADMIN TOOLS</p><h1>QA parameters</h1><p className="page-description">Manage call quality criteria and track sample results for each one.</p></div>
      <Button onClick={() => openEditor()}><Plus size={17} /> Add criterion</Button>
    </header>

    <section className="qa-params-overview">
      <div className="qa-params-score-panel">
        <div className="qa-params-score-copy"><span className="qa-params-kicker">OVERALL SAMPLE PERFORMANCE</span><strong>{percentLabel(overall)}</strong><span className="qa-params-formula">{totals.tcp} passed <i>of</i> {totals.tcr} checks</span></div>
        <div className="qa-params-ring" style={{ "--qa-ring-value": (overall ?? 0) + "%" }}><div><span>QA</span><strong>{overall === null ? "—" : Math.round(overall)}</strong></div></div>
        <div className="qa-params-score-note"><Target size={17} /><span>Change each criterion’s TCR and TCP to update the sample performance.</span></div>
      </div>
      <div className="qa-params-stat-grid">
        <article><span><ClipboardCheck size={15} /> Criteria</span><strong>{criteria.length}</strong><small>Checklist items</small></article>
        <article><span><Check size={15} /> Reviewed</span><strong>{reviewedCriteria}<small> / {criteria.length}</small></strong><small>Have a TCR value</small></article>
        <article><span><SlidersHorizontal size={15} /> Total checks</span><strong>{totals.tcr}</strong><small>Across all criteria</small></article>
        <article><span><Check size={15} /> Passed</span><strong>{totals.tcp}</strong><small>Across all criteria</small></article>
      </div>
    </section>

    <section className="qa-params-workspace">
      <div className="qa-params-toolbar">
        <div className="qa-params-category-tabs" role="group" aria-label="Filter QA criteria by category">
          <button type="button" aria-pressed={activeCategory === "All"} className={activeCategory === "All" ? "active" : ""} onClick={() => setActiveCategory("All")}>All criteria <span>{criteria.length}</span></button>
          {categories.map((category) => <button type="button" aria-pressed={activeCategory === category} className={activeCategory === category ? "active" : ""} key={category} onClick={() => setActiveCategory(category)}>{category} <span>{criteria.filter((item) => item.category === category).length}</span></button>)}
        </div>
        <label className="qa-params-search"><Search size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a criterion" aria-label="Search QA criteria" /></label>
      </div>

      <div className="qa-params-list-heading"><div><p className="qa-params-kicker">QUALITY CHECKLIST</p><h2>{activeCategory === "All" ? "Criteria library" : activeCategory}</h2></div><div className="qa-params-list-controls"><span>{filteredCriteria.length} {filteredCriteria.length === 1 ? "criterion" : "criteria"}</span><Select value={sort} onValueChange={setSort}><SelectTrigger aria-label="Sort QA criteria"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="custom">Reference order</SelectItem><SelectItem value="low">Lowest performance</SelectItem><SelectItem value="high">Highest performance</SelectItem></SelectContent></Select></div></div>

      {filteredCriteria.length ? <div className="qa-criteria-grid">{filteredCriteria.map((item, index) => {
        const performance = scoreOf(item);
        return <article className="qa-criterion-card" key={item.id}>
          <div className="qa-criterion-top"><span className="qa-criterion-number">{String(index + 1).padStart(2, "0")}</span><span className="qa-criterion-category">{item.category}</span><div className="qa-criterion-actions"><Button type="button" variant="ghost" size="icon" title="Edit criterion" aria-label={"Edit criterion " + item.criterion} onClick={() => openEditor(item)}><Pencil size={15} /></Button><Button type="button" variant="ghost" size="icon" className="qa-criterion-delete" title="Delete criterion" aria-label={"Delete criterion " + item.criterion} onClick={() => deleteCriterion(item.id)}><Trash2 size={15} /></Button></div></div>
          <h3>{item.criterion}</h3>
          <div className="qa-criterion-scoreline"><span>Performance</span><strong>{percentLabel(performance)}</strong></div>
          <div className="qa-criterion-meter" role="meter" aria-label={"Performance " + percentLabel(performance)} aria-valuemin="0" aria-valuemax="100" aria-valuenow={performance ?? 0}><i style={{ width: (performance ?? 0) + "%" }} /></div>
          <div className="qa-criterion-counts"><div><span>TCR <small>Total checks</small></span><strong>{item.tcr}</strong></div><i /><div><span>TCP <small>Passed checks</small></span><strong>{item.tcp}</strong></div><div className="qa-count-ratio"><strong>{item.tcp}<small>/{item.tcr}</small></strong><span>pass ratio</span></div></div>
        </article>;
      })}</div> : <div className="qa-params-empty"><span><ClipboardCheck size={21} /></span><strong>{query ? "No matching criteria" : "No criteria in this category"}</strong><p>{query ? "Try a different search." : "Add a criterion to build your checklist."}</p>{!query && <Button variant="outline" onClick={() => openEditor()}><Plus size={16} /> Add criterion</Button>}</div>}
      <p className="qa-params-footnote"><ArrowDownWideNarrow size={14} /> Performance is TCP ÷ TCR. The overall sample score is total TCP ÷ total TCR, so criteria with more checks carry more weight.</p>
    </section>

    {editor && <div className="qa-params-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}><form className="qa-params-dialog" role="dialog" aria-modal="true" aria-labelledby="qa-params-dialog-title" onSubmit={saveCriterion}>
      <div className="qa-params-dialog-heading"><div><p className="qa-params-kicker">{editor.id ? "EDIT QA CRITERION" : "NEW QA CRITERION"}</p><h2 id="qa-params-dialog-title">{editor.id ? "Update criterion" : "Add criterion"}</h2><p>Keep the checklist and sample score up to date.</p></div><Button type="button" variant="ghost" size="icon" aria-label="Close QA criterion form" onClick={() => setEditor(null)}><X size={17} /></Button></div>
      <label className="qa-params-field"><span>Criterion</span><textarea autoFocus rows="3" value={editor.criterion} onChange={(event) => setEditor((value) => ({ ...value, criterion: event.target.value }))} placeholder="Describe the behavior being evaluated" required /></label>
      <label className="qa-params-field"><span>Category</span><input list="qa-params-categories" value={editor.category} onChange={(event) => setEditor((value) => ({ ...value, category: event.target.value }))} placeholder="e.g. Communication" required /><datalist id="qa-params-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist></label>
      <div className="qa-params-count-fields"><label className="qa-params-field"><span>TCR <small>Total checks</small></span><input type="number" min="0" step="1" value={editor.tcr} onChange={(event) => setEditor((value) => ({ ...value, tcr: event.target.value }))} required /></label><label className="qa-params-field"><span>TCP <small>Passed checks</small></span><input type="number" min="0" step="1" max={editor.tcr || undefined} value={editor.tcp} onChange={(event) => setEditor((value) => ({ ...value, tcp: event.target.value }))} required /></label></div>
      <div className="qa-params-dialog-hint"><Target size={15} /><span>Performance updates automatically. TCP must be less than or equal to TCR.</span></div>
      <div className="qa-params-dialog-actions"><Button type="button" variant="outline" onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" disabled={!editor.criterion.trim() || !editor.category.trim() || Number(editor.tcp) > Number(editor.tcr)}>{editor.id ? "Save changes" : "Add criterion"}</Button></div>
    </form></div>}
  </section>;
}
