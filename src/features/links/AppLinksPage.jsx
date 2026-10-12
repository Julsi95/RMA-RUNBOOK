import { useEffect, useMemo, useState } from "react";
import { AppWindow, ArrowUpRight, ExternalLink, Link2, Pencil, Plus, Search, Shapes, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/app/auth-provider";
import { isSupabaseConfigured } from "@/lib/supabase";
import { loadAppLinks, saveAppLinks } from "@/lib/backend-repositories";
import "@/features/links/app-links.css";

const STORAGE_KEY = "starter-app-app-links-v1";
const DEFAULT_GROUPS = ["VF Web base", "TREC Web base", "Request forms"];

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? "resource-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function readResources() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object" && item.id && item.name) : [];
  } catch {
    return [];
  }
}

function getHost(value) {
  try { return new URL(value).host; } catch { return ""; }
}

function getFavicon(value) {
  try { return new URL("/favicon.ico", value).toString(); } catch { return ""; }
}

function ResourceIcon({ item }) {
  const [failed, setFailed] = useState(false);
  const image = getFavicon(item.url);
  return <span className="app-link-icon">{image && !failed ? <img src={image} alt="" onError={() => setFailed(true)} /> : <AppWindow size={24} strokeWidth={1.6} />}</span>;
}

export default function AppLinksPage() {
  const { canEdit, configured } = useAuth();
  const [resources, setResources] = useState(() => configured ? [] : readResources());
  const [activeGroup, setActiveGroup] = useState("All");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState(null);
  const [remoteReady, setRemoteReady] = useState(!configured);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const canManage = canEdit && remoteReady;
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    void loadAppLinks().then((items) => { if (active) { setResources(items); setLoadError(""); setRemoteReady(true); } }).catch((error) => { if (active) setLoadError(error.message || "Could not load app links."); });
    return () => { active = false; };
  }, []);
  const groups = useMemo(() => [...new Set([...DEFAULT_GROUPS, ...resources.map((item) => item.group).filter(Boolean)])], [resources]);
  const counts = useMemo(() => resources.reduce((result, item) => {
    result[item.group] = (result[item.group] ?? 0) + 1;
    return result;
  }, {}), [resources]);
  const visibleResources = resources.filter((item) => {
    const matchesGroup = activeGroup === "All" || item.group === activeGroup;
    const query = search.trim().toLowerCase();
    const matchesQuery = !query || [item.name, item.url, item.application, item.group, item.description].some((value) => (value ?? "").toLowerCase().includes(query));
    return matchesGroup && matchesQuery;
  });
  const domainCount = new Set(resources.map((item) => getHost(item.url)).filter(Boolean)).size;

  async function persist(next) {
    if (configured) {
      if (!canManage) return;
      await saveAppLinks(next);
    }
    setResources(next);
    if (!configured) try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* keep changes for this session */ }
    setSaveError("");
  }

  function openEditor(item = null) {
    if (!canManage) return;
    setEditor(item ? { ...item } : { id: "", name: "", url: "", application: "", group: activeGroup === "All" ? DEFAULT_GROUPS[0] : activeGroup, description: "" });
  }

  async function saveResource(event) {
    event.preventDefault();
    if (!canManage) return;
    const name = editor.name.trim();
    const url = editor.url.trim();
    const group = editor.group.trim();
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) return;
    } catch { return; }
    if (!name || !group) return;
    const item = { ...editor, id: editor.id || newId(), name, url, group, application: editor.application.trim(), description: editor.description.trim() };
    try { await persist(editor.id ? resources.map((current) => current.id === editor.id ? item : current) : [item, ...resources]); }
    catch (error) { setSaveError(error.message || "Could not save this resource."); return; }
    setActiveGroup(group);
    setEditor(null);
  }

  async function deleteResource(id) {
    if (!canManage) return;
    try { await persist(resources.filter((item) => item.id !== id)); }
    catch (error) { setSaveError(error.message || "Could not delete this resource."); }
  }

  return <section className="page-content app-links-page">
    <header className="page-heading app-links-heading">
      <div><p className="eyebrow">TEAM TOOLKIT</p><h1>App / Links</h1><p className="page-description">Your team’s web bases, applications, and request forms in one launchpad.</p></div>
      {canManage && <Button onClick={() => openEditor()}><Plus size={17} /> Add resource</Button>}
    </header>
    {(loadError || saveError) && <p className="auth-error" role="alert">{saveError || loadError}</p>}

    <section className="app-links-hero" aria-label="Resource library overview">
      <div className="app-links-hero-copy"><span className="app-links-hero-mark"><Shapes size={20} /></span><div><p className="app-links-hero-kicker">QUICK ACCESS LIBRARY</p><h2>Everything your shift needs.</h2><p>Choose a collection, find the right tool, and launch it in a new tab.</p></div></div>
      <div className="app-links-hero-stats"><div><strong>{resources.length}</strong><span>resources</span></div><i /><div><strong>{groups.filter((group) => counts[group]).length}</strong><span>collections</span></div><i /><div><strong>{domainCount}</strong><span>web bases</span></div></div>
      <div className="app-links-orbit app-links-orbit-one" aria-hidden="true" /><div className="app-links-orbit app-links-orbit-two" aria-hidden="true" />
    </section>

    <section className="app-links-library">
      <div className="app-links-controls">
        <div className="app-links-collections" role="tablist" aria-label="Filter resources by collection">
          <button type="button" role="tab" aria-selected={activeGroup === "All"} className={activeGroup === "All" ? "active" : ""} onClick={() => setActiveGroup("All")}>All <span>{resources.length}</span></button>
          {groups.map((group) => <button type="button" role="tab" aria-selected={activeGroup === group} className={activeGroup === group ? "active" : ""} key={group} onClick={() => setActiveGroup(group)}>{group} <span>{counts[group] ?? 0}</span></button>)}
        </div>
        <label className="app-links-search"><Search size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tools, links, or apps" aria-label="Search app links" /></label>
      </div>

      <div className="app-links-section-heading"><div><p className="app-links-kicker">{activeGroup === "All" ? "RESOURCE DIRECTORY" : "COLLECTION"}</p><h2>{activeGroup === "All" ? "Browse resources" : activeGroup}</h2></div><span>{visibleResources.length} {visibleResources.length === 1 ? "resource" : "resources"}</span></div>

      {visibleResources.length ? <div className="app-links-grid">{visibleResources.map((item, index) => <article className={"app-link-card app-link-tone-" + (index % 4)} key={item.id}>
        <div className="app-link-card-top"><span className="app-link-group-tag"><i />{item.group}</span>{canManage && <div className="app-link-actions"><Button type="button" variant="ghost" size="icon" title="Edit resource" aria-label={"Edit " + item.name} onClick={() => openEditor(item)}><Pencil size={15} /></Button><Button type="button" variant="ghost" size="icon" className="app-link-delete" title="Delete resource" aria-label={"Delete " + item.name} onClick={() => void deleteResource(item.id)}><Trash2 size={15} /></Button></div>}</div>
        <div className="app-link-card-main"><ResourceIcon item={item} /><div className="app-link-title"><h3>{item.name}</h3>{item.application && <span>{item.application}</span>}</div><span className="app-link-card-number">{String(index + 1).padStart(2, "0")}</span></div>
        {item.description && <p className="app-link-description">{item.description}</p>}
        <a className="app-link-url" href={item.url} target="_blank" rel="noreferrer noopener"><span>{item.url}</span><ArrowUpRight size={15} /></a>
        <div className="app-link-card-footer"><span><Link2 size={13} />{getHost(item.url) || "Web resource"}</span><a className="app-link-launch" href={item.url} target="_blank" rel="noreferrer noopener"><ExternalLink size={15} /> Launch app <ArrowUpRight size={15} /></a></div>
      </article>)}</div> : <div className="app-links-empty"><span><AppWindow size={22} /></span><strong>{search ? "No matching resources" : resources.length ? "Nothing in this collection yet" : "Your launchpad is ready"}</strong><p>{search ? "Try a different search, or switch collections." : canManage ? "Add your first web base, app, or request form to get started." : "No resources have been published yet."}</p>{!search && canManage && <Button variant="outline" onClick={() => openEditor()}><Plus size={16} /> Add a resource</Button>}</div>}
    </section>

    {editor && canManage && <div className="app-links-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}><form className="app-links-dialog" role="dialog" aria-modal="true" aria-labelledby="app-links-dialog-title" onSubmit={saveResource}>
      <div className="app-links-dialog-heading"><div><p className="app-links-kicker">{editor.id ? "EDIT RESOURCE" : "NEW RESOURCE"}</p><h2 id="app-links-dialog-title">{editor.id ? "Update resource" : "Add to your launchpad"}</h2><p>Set the link and choose how it appears in the library.</p></div><Button type="button" variant="ghost" size="icon" aria-label="Close resource form" onClick={() => setEditor(null)}><X size={17} /></Button></div>
      <div className="app-links-form-grid">
        <label className="app-links-field"><span>Resource name</span><input autoFocus value={editor.name} onChange={(event) => setEditor((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Okta" required /></label>
        <label className="app-links-field"><span>Collection</span><input list="app-links-known-groups" value={editor.group} onChange={(event) => setEditor((current) => ({ ...current, group: event.target.value }))} placeholder="e.g. VF Web base" required /><datalist id="app-links-known-groups">{groups.map((group) => <option value={group} key={group} />)}</datalist></label>
        <label className="app-links-field app-links-field-wide"><span>URL</span><input type="url" value={editor.url} onChange={(event) => setEditor((current) => ({ ...current, url: event.target.value }))} placeholder="https://…" required /></label>
        <label className="app-links-field app-links-field-wide"><span>Application or service <small>Optional</small></span><input value={editor.application} onChange={(event) => setEditor((current) => ({ ...current, application: event.target.value }))} placeholder="e.g. Microsoft Teams" /></label>
        <label className="app-links-field app-links-field-wide"><span>Short note <small>Optional</small></span><input value={editor.description} onChange={(event) => setEditor((current) => ({ ...current, description: event.target.value }))} placeholder="What this resource is for" /></label>
      </div>
      <div className="app-links-form-hint"><Link2 size={15} /><span>A site icon will appear when the linked website provides one. The URL remains visible on every card.</span></div>
      <div className="app-links-dialog-actions"><Button type="button" variant="outline" onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" disabled={!editor.name.trim() || !editor.group.trim() || !editor.url.trim()}>{editor.id ? "Save changes" : "Add resource"}</Button></div>
    </form></div>}
  </section>;
}
