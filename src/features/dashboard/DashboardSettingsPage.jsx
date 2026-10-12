import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Copy, Eye, GripVertical, ImagePlus, LoaderCircle, Monitor, Pencil, Plus, RotateCcw, Smartphone, Tablet, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import DashboardContainer from "@/features/dashboard/DashboardContainer";
import { CONTAINER_TYPES, CONTAINER_TYPE_LABELS, clearDashboardDraft, createDefaultDashboard, makeContainer, persistDashboardDraft, publishDashboard, readDashboardDraft, readPublishedDashboard } from "@/features/dashboard/dashboard-data";
import { useAuth } from "@/app/auth-provider";
import { isSupabaseConfigured } from "@/lib/supabase";
import { retryDataLoad } from "@/lib/backend/shared";
import { discardDashboardDraft, loadDashboardDraft, loadPublishedDashboard, publishDashboardDocument, saveDashboardDraft } from "@/lib/backend-repositories";
import "@/features/dashboard/dashboard.css";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeUrl(value) {
  if (!value) return true;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

function safeImageUrl(value) {
  if (!value) return true;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value)) return true;
  try { return ["http:", "https:"].includes(new URL(value, window.location.origin).protocol); } catch { return false; }
}

async function compressImage(file) {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 15 * 1024 * 1024) throw new Error("Choose an image under 15 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1440 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not read this image.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  let compressed = canvas.toDataURL("image/webp", 0.74);
  if (compressed.length > 700_000) compressed = canvas.toDataURL("image/webp", 0.58);
  if (compressed.length > 1_100_000) throw new Error("This image is still too large. Try a smaller file.");
  return compressed;
}

function DeviceButton({ active, onClick, label, children }) {
  return <button type="button" className={"dashboard-device-button" + (active ? " active" : "")} aria-pressed={active} aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

const TEXT_POSITIONS = {
  "top-left": { label: "Top left", x: 8, y: 10 },
  "top-center": { label: "Top center", x: 50, y: 10 },
  "top-right": { label: "Top right", x: 92, y: 10 },
  "center-left": { label: "Center left", x: 8, y: 50 },
  center: { label: "Center", x: 50, y: 50 },
  "center-right": { label: "Center right", x: 92, y: 50 },
  "bottom-left": { label: "Bottom left", x: 8, y: 90 },
  "bottom-center": { label: "Bottom center", x: 50, y: 90 },
  "bottom-right": { label: "Bottom right", x: 92, y: 90 },
};

export default function DashboardSettingsPage() {
  const { configured, user } = useAuth();
  const [draft, setDraft] = useState(() => configured ? createDefaultDashboard() : readDashboardDraft() ?? readPublishedDashboard());
  const [published, setPublished] = useState(() => configured ? createDefaultDashboard() : readPublishedDashboard());
  const [remoteReady, setRemoteReady] = useState(!configured);
  const [hasChanges, setHasChanges] = useState(() => configured ? false : Boolean(readDashboardDraft()));
  const [message, setMessage] = useState(() => configured ? "Loading saved dashboard" : readDashboardDraft() ? "Draft restored" : "Live dashboard");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [previewMode, setPreviewMode] = useState(false);
  const [viewport, setViewport] = useState("desktop");
  const [newType, setNewType] = useState("feature");
  const [editor, setEditor] = useState(null);
  const [draggedId, setDraggedId] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");
  const draftRef = useRef(draft);
  const resizeSession = useRef(null);
  const draftItemCount = useMemo(() => draft.containers.length, [draft.containers.length]);

  useEffect(() => {
    if (!configured || !user) return undefined;
    let active = true;
    void retryDataLoad(() => Promise.all([loadPublishedDashboard(), loadDashboardDraft(user.id)])).then(([saved, remoteDraft]) => {
      if (!active) return;
      const publishedState = saved ?? createDefaultDashboard();
      const nextDraft = remoteDraft ?? publishedState;
      setPublished(publishedState); setDraft(nextDraft); draftRef.current = nextDraft;
      setHasChanges(Boolean(remoteDraft)); setMessage(remoteDraft ? "Draft restored" : "Live dashboard");
      setRemoteReady(true);
    }).catch((error) => { if (active) setMessage(error.message || "Could not load the saved dashboard."); });
    return () => { active = false; };
  }, [configured, user?.id, loadAttempt]);

  useEffect(() => {
    if (!configured || !user || !remoteReady || !hasChanges) return undefined;
    const timeout = window.setTimeout(() => {
      void saveDashboardDraft(user.id, draft).then(() => setMessage("Draft saved to your editor account")).catch((error) => setMessage(error.message || "Could not save dashboard draft."));
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [configured, user?.id, draft, hasChanges, remoteReady]);

  function commitDraft(next) {
    if (configured && !remoteReady) return;
    draftRef.current = next;
    setDraft(next);
    setHasChanges(true);
    setMessage("Draft saved on this device");
    if (!configured) {
      try { persistDashboardDraft(next); }
      catch { setMessage("Draft is active but too large to save in browser storage"); }
    }
  }

  function patchPage(patch) {
    commitDraft({ ...draft, ...patch });
  }

  function addContainer() {
    if (configured && !remoteReady) return;
    const item = makeContainer(newType);
    setEditor(clone(item));
    setImageError("");
  }

  function openEditor(item) {
    if (configured && !remoteReady) return;
    const next = clone(item);
    next.images = Array.isArray(next.images) ? next.images : (next.image ? [{ id: "legacy-image", src: next.image }] : []);
    next.imageMode = next.imageMode || "single";
    setEditor(next);
    setImageError("");
  }

  function saveContainer(event) {
    event.preventDefault();
    if (!editorHasContent || Boolean(editor.buttonLabel.trim()) !== Boolean(editor.buttonUrl.trim())) return;
    if (!safeUrl(editor.buttonUrl) || editor.images.some((image) => !safeImageUrl(image.src)) || editor.links.some((link) => !safeUrl(link.url))) return;
    const links = editor.links.filter((link) => link.label.trim() || link.url.trim()).map((link) => ({ ...link, label: link.label.trim(), url: link.url.trim() }));
    const textLayers = (editor.textLayers ?? []).map((layer) => ({ ...layer, text: layer.text.trim() })).filter((layer) => layer.text);
    const images = editor.images.filter((image) => image.src.trim()).map((image) => ({ ...image, src: image.src.trim() }));
    const saved = { ...editor, images, image: images[0]?.src || "", imageMode: images.length > 1 && editor.imageMode === "carousel" ? "carousel" : "single", title: editor.title.trim(), eyebrow: (editor.eyebrow || "").trim(), description: editor.description.trim(), body: editor.body.trim(), buttonLabel: editor.buttonLabel.trim(), buttonUrl: editor.buttonUrl.trim(), links, textLayers };
    const exists = draft.containers.some((item) => item.id === saved.id);
    commitDraft({ ...draft, containers: exists ? draft.containers.map((item) => item.id === saved.id ? saved : item) : [...draft.containers, saved] });
    setEditor(null);
    setImageError("");
  }

  function updateEditor(patch) {
    setEditor((current) => ({ ...current, ...patch }));
  }

  function deleteContainer(id) {
    commitDraft({ ...draft, containers: draft.containers.filter((item) => item.id !== id) });
    setMessage("Container deleted from draft");
  }

  function duplicateContainer(item) {
    const copy = { ...clone(item), id: globalThis.crypto?.randomUUID?.() ?? "dashboard-copy-" + Date.now(), title: item.title ? item.title + " (copy)" : "" };
    const index = draft.containers.findIndex((entry) => entry.id === item.id);
    const containers = [...draft.containers];
    containers.splice(index + 1, 0, copy);
    commitDraft({ ...draft, containers });
    setMessage("Container duplicated");
  }

  function moveContainer(fromId, toId) {
    if (fromId === toId || !fromId || !toId) return;
    const fromIndex = draft.containers.findIndex((item) => item.id === fromId);
    const toIndex = draft.containers.findIndex((item) => item.id === toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const containers = [...draft.containers];
    [containers[fromIndex], containers[toIndex]] = [containers[toIndex], containers[fromIndex]];
    commitDraft({ ...draft, containers });
    setDraggedId("");
  }

  function moveBy(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= draft.containers.length) return;
    moveContainer(draft.containers[index].id, draft.containers[target].id);
  }

  async function publishChanges() {
    if (configured && !remoteReady) return;
    try {
      let publishedDocument = draft;
      if (configured) ({ document: publishedDocument } = await publishDashboardDocument(draft));
      publishDashboard(publishedDocument);
      setDraft(publishedDocument); draftRef.current = publishedDocument; setPublished(publishedDocument);
      setHasChanges(false); setMessage("Changes published to the live dashboard");
    } catch (error) { setMessage(error.message || (configured ? "Could not publish dashboard." : "Could not publish. Browser storage may be full.")); }
  }

  async function discardChanges() {
    if (configured && !remoteReady) return;
    if (configured && user) {
      try { await discardDashboardDraft(user.id); } catch (error) { setMessage(error.message || "Could not discard remote draft."); return; }
    }
    try { clearDashboardDraft(); } catch { /* the visible draft is still reset */ }
    setDraft(published); draftRef.current = published;
    setHasChanges(false);
    setEditor(null);
    setImageError("");
    setMessage("Draft discarded · live dashboard unchanged");
  }

  function addImage() {
    const image = { id: globalThis.crypto?.randomUUID?.() ?? "image-" + Date.now(), src: "" };
    const images = [...editor.images, image];
    updateEditor({ images, imageMode: images.length > 1 ? "carousel" : editor.imageMode });
  }

  function updateImage(id, src) {
    const images = editor.images.map((image) => image.id === id ? { ...image, src } : image);
    updateEditor({ images, image: images[0]?.src || "" });
  }

  function removeImage(id) {
    const images = editor.images.filter((image) => image.id !== id);
    updateEditor({ images, image: images[0]?.src || "", imageMode: images.length > 1 ? editor.imageMode : "single" });
  }

  async function handleImageUpload(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    setImageBusy(true);
    setImageError("");
    try {
      const additions = [];
      for (const file of files) additions.push({ id: globalThis.crypto?.randomUUID?.() ?? "image-" + Date.now() + "-" + additions.length, src: await compressImage(file) });
      setEditor((current) => {
        const images = [...current.images, ...additions];
        return { ...current, images, image: images[0]?.src || "", imageMode: images.length > 1 ? "carousel" : current.imageMode };
      });
      setMessage(additions.length > 1 ? `${additions.length} images added to container draft` : "Image added to container draft");
    } catch (error) {
      setImageError(error.message || "Could not process this image.");
    } finally {
      setImageBusy(false);
    }
  }

  function updateQuickLink(id, patch) {
    updateEditor({ links: editor.links.map((link) => link.id === id ? { ...link, ...patch } : link) });
  }

  function addQuickLink() {
    updateEditor({ links: [...editor.links, { id: globalThis.crypto?.randomUUID?.() ?? "quick-" + Date.now(), label: "", url: "" }] });
  }

  function removeQuickLink(id) {
    updateEditor({ links: editor.links.filter((link) => link.id !== id) });
  }

  function addTextLayer() {
    const layer = { id: globalThis.crypto?.randomUUID?.() ?? "text-" + Date.now(), text: "New text", x: 8, y: 10, anchor: "top-left", fontSize: 24, fontWeight: 600, fontStyle: "normal", fontFamily: "sans-serif", color: "#ffffff", align: "left" };
    updateEditor({ textLayers: [...(editor.textLayers ?? []), layer] });
  }

  function updateTextLayer(id, patch) {
    updateEditor({ textLayers: (editor.textLayers ?? []).map((layer) => layer.id === id ? { ...layer, ...patch } : layer) });
  }

  function removeTextLayer(id) {
    updateEditor({ textLayers: (editor.textLayers ?? []).filter((layer) => layer.id !== id) });
  }

  function startContainerResize(event, item) {
    event.preventDefault();
    event.stopPropagation();
    const direction = event.currentTarget.dataset.resize;
    const grid = event.currentTarget.closest(".dashboard-layout-grid");
    if (!grid) return;
    const gridRect = grid.getBoundingClientRect();
    const columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").length);
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
    resizeSession.current = { id: item.id, direction, startX: event.clientX, startY: event.clientY, width: Number(item.width) || 12, height: Number(item.height) || 250, cellWidth: (gridRect.width - gap * (columns - 1)) / columns, columns };

    function move(moveEvent) {
      const session = resizeSession.current;
      if (!session) return;
      const horizontal = session.direction.includes("e") ? 1 : session.direction.includes("w") ? -1 : 0;
      const vertical = session.direction.includes("s") ? 1 : session.direction.includes("n") ? -1 : 0;
      const widthDelta = horizontal && session.columns > 1 ? Math.round((moveEvent.clientX - session.startX) * horizontal / session.cellWidth * 24 / session.columns) : 0;
      const heightDelta = vertical ? Math.round((moveEvent.clientY - session.startY) * vertical / 10) * 10 : 0;
      const width = Math.min(24, Math.max(1, session.width + widthDelta));
      const height = Math.min(800, Math.max(120, session.height + heightDelta));
      setDraft((current) => {
        const next = { ...current, containers: current.containers.map((entry) => entry.id === session.id ? { ...entry, width, height } : entry) };
        draftRef.current = next;
        return next;
      });
      setHasChanges(true);
      setMessage(`Resizing · ${Math.round((width / 24) * 100)}% × ${height}px`);
    }

    function finish() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (!resizeSession.current) return;
      resizeSession.current = null;
      try {
        persistDashboardDraft(draftRef.current);
        setMessage("Draft saved on this device");
      } catch {
        setMessage("Size is active but too large to save in browser storage");
      }
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  }

  const editorHasContent = editor && Boolean(editor.images.some((image) => image.src) || (editor.title || "").trim() || (editor.eyebrow || "").trim() || (editor.description || "").trim() || (editor.body || "").trim() || (editor.buttonLabel || "").trim() || editor.links.some((link) => (link.label || "").trim() || (link.url || "").trim()) || (editor.textLayers ?? []).some((layer) => (layer.text || "").trim()));
  const editorCanSave = editorHasContent && Boolean(editor.buttonLabel.trim()) === Boolean(editor.buttonUrl.trim()) && safeUrl(editor.buttonUrl) && editor.images.every((image) => safeImageUrl(image.src)) && editor.links.every((link) => safeUrl(link.url));

  return <section className="page-content dashboard-builder-page">
    <header className="page-heading dashboard-builder-heading">
      <div><p className="eyebrow">WORKSPACE · BUILDER</p><h1>Dashboard settings</h1><p className="page-description">Arrange announcements, features, messages, and shortcuts for your team home.</p></div>
      <div className="dashboard-builder-heading-actions"><span className={"dashboard-draft-status" + (hasChanges ? " has-draft" : "")}><i />{message}</span>{configured && !remoteReady && <Button type="button" variant="outline" onClick={() => setLoadAttempt((attempt) => attempt + 1)}><LoaderCircle size={15} className="dashboard-live-spinner" /> Retry loading</Button>}<Button type="button" variant="outline" onClick={discardChanges} disabled={!hasChanges || (configured && !remoteReady)}><RotateCcw size={15} /> Discard changes</Button><Button type="button" onClick={publishChanges} disabled={!hasChanges || Boolean(editor) || (configured && !remoteReady)}><Check size={15} /> Save changes</Button></div>
    </header>

    <section className="dashboard-builder-intro">
      <div className="dashboard-builder-intro-heading"><div><p className="dashboard-builder-kicker">PAGE INTRO</p><strong>Set the welcome message</strong></div><span>Appears above the containers</span></div>
      <div className="dashboard-builder-intro-fields"><label><span>Dashboard title</span><input value={draft.pageTitle} onChange={(event) => patchPage({ pageTitle: event.target.value })} placeholder="Good morning" /></label><label><span>Short description</span><input value={draft.pageDescription} onChange={(event) => patchPage({ pageDescription: event.target.value })} placeholder="A clear view of what’s happening…" /></label></div>
    </section>

    <section className="dashboard-layout-settings" aria-label="Dashboard spacing settings">
      <label><span><strong>Container spacing</strong><output>{draft.containerGap}px</output></span><input type="range" min="4" max="40" step="1" value={draft.containerGap} onChange={(event) => patchPage({ containerGap: Number(event.target.value) })} /></label>
      <label><span><strong>Page padding</strong><output>{draft.canvasPadding}px</output></span><input type="range" min="0" max="48" step="1" value={draft.canvasPadding} onChange={(event) => patchPage({ canvasPadding: Number(event.target.value) })} /></label>
    </section>

    <section className="dashboard-builder-workspace">
      <div className="dashboard-builder-toolbar">
        <div className="dashboard-builder-toolbar-left"><span className="dashboard-container-count">{draftItemCount} {draftItemCount === 1 ? "container" : "containers"}</span><span className="dashboard-builder-help">{previewMode ? "Previewing draft · links are active" : "Drag a container handle to swap its position"}</span></div>
        <div className="dashboard-builder-toolbar-actions">
          {!previewMode && <div className="dashboard-add-control"><Select value={newType} onValueChange={setNewType}><SelectTrigger aria-label="New container type"><SelectValue /></SelectTrigger><SelectContent>{CONTAINER_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" onClick={addContainer}><Plus size={15} /> Add container</Button></div>}
          <div className="dashboard-preview-devices" aria-label="Preview screen size"><DeviceButton label="Desktop preview" active={viewport === "desktop"} onClick={() => setViewport("desktop")}><Monitor size={15} /></DeviceButton><DeviceButton label="Tablet preview" active={viewport === "tablet"} onClick={() => setViewport("tablet")}><Tablet size={15} /></DeviceButton><DeviceButton label="Mobile preview" active={viewport === "mobile"} onClick={() => setViewport("mobile")}><Smartphone size={15} /></DeviceButton></div>
          <Button type="button" variant={previewMode ? "default" : "outline"} onClick={() => setPreviewMode((value) => !value)}>{previewMode ? <><ArrowLeft size={15} /> Back to editor</> : <><Eye size={15} /> Preview mode</>}</Button>
        </div>
      </div>

      <div className={"dashboard-builder-stage" + (previewMode ? " is-previewing" : "")}>
        <div className={"dashboard-preview-frame preview-" + viewport} style={{ "--dashboard-gap": `${draft.containerGap}px`, "--dashboard-canvas-padding": `${draft.canvasPadding}px` }}>
          <header className="dashboard-preview-heading"><p className="eyebrow">YOUR WORKSPACE</p><h1>{draft.pageTitle || "Your dashboard"}</h1>{draft.pageDescription && <p className="page-description">{draft.pageDescription}</p>}</header>
          {draft.containers.length ? <div className="dashboard-layout-grid">{draft.containers.map((item, index) => previewMode ? <DashboardContainer item={item} linksEnabled key={item.id} /> : <div className={"dashboard-builder-item" + (draggedId === item.id ? " is-dragged" : "")} style={{ "--dashboard-span-desktop": item.width || 12, "--dashboard-span-tablet": Math.ceil((item.width || 12) / 2), "--dashboard-height": `${item.height || 250}px` }} key={item.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); moveContainer(event.dataTransfer.getData("text/plain"), item.id); }}>
            <div className="dashboard-container-tools"><button type="button" className="dashboard-drag-handle" draggable="true" title="Drag to swap position" aria-label={"Drag " + item.title + " to reorder"} onDragStart={(event) => { setDraggedId(item.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); }} onDragEnd={() => setDraggedId("")}><GripVertical size={16} /><span>{CONTAINER_TYPE_LABELS[item.type]}</span></button><div><Button type="button" variant="ghost" size="icon" title="Move earlier" aria-label={"Move " + item.title + " earlier"} disabled={index === 0} onClick={() => moveBy(index, -1)}><ArrowUp size={14} /></Button><Button type="button" variant="ghost" size="icon" title="Move later" aria-label={"Move " + item.title + " later"} disabled={index === draft.containers.length - 1} onClick={() => moveBy(index, 1)}><ArrowDown size={14} /></Button><Button type="button" variant="ghost" size="icon" title="Edit container" aria-label={"Edit " + item.title} onClick={() => openEditor(item)}><Pencil size={14} /></Button><Button type="button" variant="ghost" size="icon" title="Duplicate container" aria-label={"Duplicate " + item.title} onClick={() => duplicateContainer(item)}><Copy size={14} /></Button><Button type="button" variant="ghost" size="icon" className="dashboard-container-delete" title="Delete container" aria-label={"Delete " + item.title} onClick={() => deleteContainer(item.id)}><Trash2 size={14} /></Button></div></div>
            <DashboardContainer item={item} />
            {["n", "ne", "e", "se", "s", "sw", "w", "nw"].map((direction) => <button type="button" className={`dashboard-resize-handle resize-${direction}`} data-resize={direction} key={direction} aria-label={`Resize ${item.title || "image container"} from ${({ n: "top", ne: "top-right", e: "right", se: "bottom-right", s: "bottom", sw: "bottom-left", w: "left", nw: "top-left" })[direction]} edge`} title="Drag to resize" onPointerDown={(event) => startContainerResize(event, item)} />)}
          </div>)}</div> : <div className="dashboard-builder-empty"><span><Plus size={20} /></span><strong>No containers yet</strong><p>Add an announcement, feature, message, or quick links section.</p></div>}
        </div>
      </div>
      <div className="dashboard-builder-footer"><span>Preview at any screen size. Save changes to publish this draft to the Dashboard.</span><span>{hasChanges ? "Draft remains private until published" : "Live dashboard is up to date"}</span></div>
    </section>

    {editor && <div className="dashboard-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !imageBusy) setEditor(null); }}><form className="dashboard-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="dashboard-editor-title" onSubmit={saveContainer}>
      <div className="dashboard-editor-heading"><div><p className="dashboard-builder-kicker">{CONTAINER_TYPE_LABELS[editor.type]}</p><h2 id="dashboard-editor-title">Edit container</h2><p>Choose its content and how much space it takes.</p></div><Button type="button" variant="ghost" size="icon" aria-label="Close container editor" onClick={() => setEditor(null)}><X size={17} /></Button></div>
      <div className="dashboard-editor-scroll">
        <div className="dashboard-editor-grid"><label className="dashboard-editor-field"><span>Container type</span><Select value={editor.type} onValueChange={(type) => updateEditor({ type })}><SelectTrigger aria-label="Container type"><SelectValue /></SelectTrigger><SelectContent>{CONTAINER_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></label><label className="dashboard-editor-field"><span>Width <output>{Math.round((editor.width / 24) * 100)}% of page</output></span><input type="range" min="1" max="24" step="1" value={editor.width} onChange={(event) => updateEditor({ width: Number(event.target.value) })} aria-label="Container width" /></label><label className="dashboard-editor-field"><span>Height <output>{editor.height}px</output></span><input type="range" min="120" max="800" step="10" value={editor.height} onChange={(event) => updateEditor({ height: Number(event.target.value) })} aria-label="Container height" /></label><label className="dashboard-editor-field"><span>Small label <small>Optional</small></span><input value={editor.eyebrow} onChange={(event) => updateEditor({ eyebrow: event.target.value })} placeholder={CONTAINER_TYPE_LABELS[editor.type]} /></label></div>
        <label className="dashboard-editor-field"><span>Title <small>Optional for image-only containers</small></span><input value={editor.title} onChange={(event) => updateEditor({ title: event.target.value })} placeholder="Give this section a title" /></label>
        <label className="dashboard-editor-field"><span>Description</span><textarea rows="2" value={editor.description} onChange={(event) => updateEditor({ description: event.target.value })} placeholder="Add a short supporting description" /></label>
        {editor.type !== "quickLinks" && <label className="dashboard-editor-field"><span>{editor.type === "announcement" ? "Announcement message" : editor.type === "content" ? "Motto or quote" : "Supporting text"}</span><textarea rows="3" value={editor.body} onChange={(event) => updateEditor({ body: event.target.value })} placeholder="Write the message for this container" /></label>}
        {editor.type === "announcement" && <div className="dashboard-editor-inline"><label className="dashboard-editor-field"><span>Announcement date</span><input type="date" value={editor.date} onChange={(event) => updateEditor({ date: event.target.value })} /></label><label className="dashboard-editor-checkbox"><input type="checkbox" checked={editor.showDate} onChange={(event) => updateEditor({ showDate: event.target.checked })} /><span>Show date on dashboard</span></label></div>}
        <section className="dashboard-image-editor">
          <div className="dashboard-editor-section-heading"><div><strong>Images <small>{editor.images.length} added</small></strong><small>Add one image or several for a carousel.</small></div><Button type="button" variant="outline" size="sm" onClick={addImage}><Plus size={14} /> Add image</Button></div>
          <label className="dashboard-upload-button"><ImagePlus size={15} />{imageBusy ? "Preparing images…" : "Upload images"}<input type="file" accept="image/*" multiple disabled={imageBusy} onChange={(event) => { handleImageUpload(event.target.files); event.target.value = ""; }} /></label>
          {editor.images.map((image, index) => <div className="dashboard-image-editor-row" key={image.id}>
            {image.src && <div className="dashboard-editor-image-preview"><img src={image.src} alt={`Container image ${index + 1}`} /></div>}
            <div className="dashboard-image-editor-fields"><span>Image {String(index + 1).padStart(2, "0")}</span><input aria-label={`Image ${index + 1} URL`} value={image.src.startsWith("data:") ? "" : image.src} onChange={(event) => updateImage(image.id, event.target.value)} placeholder="https://example.com/image.jpg" />{image.src.startsWith("data:") && <small className="dashboard-uploaded-label">Uploaded image</small>}</div>
            <Button type="button" variant="ghost" size="icon" className="dashboard-container-delete" title="Remove image" aria-label={`Remove image ${index + 1}`} onClick={() => removeImage(image.id)}><Trash2 size={14} /></Button>
          </div>)}
          {imageError && <span className="dashboard-editor-error">{imageError}</span>}
        </section>
        {editor.images.length > 1 && <section className="dashboard-carousel-settings">
          <label className="dashboard-editor-field"><span>Image display</span><Select value={editor.imageMode || "single"} onValueChange={(imageMode) => updateEditor({ imageMode })}><SelectTrigger aria-label="Image display"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="single">Show one image</SelectItem><SelectItem value="carousel">Carousel</SelectItem></SelectContent></Select></label>
          {editor.imageMode === "carousel" && <><label className="dashboard-editor-field"><span>Transition</span><Select value={editor.carouselEffect || "slide"} onValueChange={(carouselEffect) => updateEditor({ carouselEffect })}><SelectTrigger aria-label="Carousel transition"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="slide">Slide</SelectItem><SelectItem value="fade">Fade</SelectItem></SelectContent></Select></label><label className="dashboard-editor-checkbox"><input type="checkbox" checked={Boolean(editor.carouselAutoplay)} onChange={(event) => updateEditor({ carouselAutoplay: event.target.checked })} /><span>Automatically play</span></label>{editor.carouselAutoplay && <label className="dashboard-editor-field"><span>Change image every <output>{editor.carouselInterval || 5}s</output></span><input type="range" min="2" max="10" step="1" value={editor.carouselInterval || 5} onChange={(event) => updateEditor({ carouselInterval: Number(event.target.value) })} /></label>}<label className="dashboard-editor-checkbox"><input type="checkbox" checked={editor.carouselControls !== false} onChange={(event) => updateEditor({ carouselControls: event.target.checked })} /><span>Show previous / next controls</span></label><label className="dashboard-editor-checkbox"><input type="checkbox" checked={editor.carouselIndicators !== false} onChange={(event) => updateEditor({ carouselIndicators: event.target.checked })} /><span>Show image indicators</span></label></>}
        </section>}
        {editor.images.some((image) => image.src) && <div className="dashboard-editor-grid"><label className="dashboard-editor-field"><span>Image fit</span><Select value={editor.imageFit || "cover"} onValueChange={(imageFit) => updateEditor({ imageFit })}><SelectTrigger aria-label="Image fit"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cover">Fill container</SelectItem><SelectItem value="contain">Show full image</SelectItem></SelectContent></Select></label><label className="dashboard-editor-field"><span>Text position</span><Select value={editor.textPosition || "below"} onValueChange={(textPosition) => updateEditor({ textPosition })}><SelectTrigger aria-label="Text position"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="below">Below image</SelectItem><SelectItem value="top-left">Top left</SelectItem><SelectItem value="top-center">Top center</SelectItem><SelectItem value="top-right">Top right</SelectItem><SelectItem value="center-left">Center left</SelectItem><SelectItem value="center">Center</SelectItem><SelectItem value="center-right">Center right</SelectItem><SelectItem value="bottom-left">Bottom left</SelectItem><SelectItem value="bottom-center">Bottom center</SelectItem><SelectItem value="bottom-right">Bottom right</SelectItem></SelectContent></Select></label></div>}
        {editor.images.some((image) => image.src) && editor.textPosition !== "below" && <div className="dashboard-overlay-settings"><label className="dashboard-editor-field"><span>Text background</span><Select value={editor.textBackground || "none"} onValueChange={(textBackground) => updateEditor({ textBackground })}><SelectTrigger aria-label="Text background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="tint">Tinted</SelectItem><SelectItem value="solid">Solid</SelectItem><SelectItem value="glass">Glass</SelectItem></SelectContent></Select></label>{editor.textBackground !== "none" && <><label className="dashboard-editor-field"><span>Background color</span><input type="color" value={editor.textBackgroundColor || "#17171b"} onChange={(event) => updateEditor({ textBackgroundColor: event.target.value })} /></label><label className="dashboard-editor-field"><span>Background opacity <output>{editor.textBackgroundOpacity ?? 74}%</output></span><input type="range" min="0" max="100" step="1" value={editor.textBackgroundOpacity ?? 74} onChange={(event) => updateEditor({ textBackgroundOpacity: Number(event.target.value) })} /></label></>}<label className="dashboard-editor-field"><span>Text color</span><input type="color" value={editor.textColor || "#ffffff"} onChange={(event) => updateEditor({ textColor: event.target.value })} /></label></div>}
        <section className="dashboard-text-layer-editor">
          <div className="dashboard-editor-section-heading"><div><strong>Text layers</strong><small>Add independent text overlays and style each one.</small></div><Button type="button" variant="outline" size="sm" onClick={addTextLayer}><Plus size={14} /> Add text</Button></div>
          {(editor.textLayers ?? []).map((layer, index) => <article className="dashboard-text-layer-fields" key={layer.id}>
            <div className="dashboard-text-layer-heading"><strong>Text {String(index + 1).padStart(2, "0")}</strong><Button type="button" variant="ghost" size="icon" className="dashboard-container-delete" aria-label={`Delete text ${index + 1}`} onClick={() => removeTextLayer(layer.id)}><Trash2 size={14} /></Button></div>
            <label className="dashboard-editor-field"><span>Text</span><textarea rows="2" value={layer.text} onChange={(event) => updateTextLayer(layer.id, { text: event.target.value })} placeholder="Type your text" /></label>
            <div className="dashboard-editor-grid"><label className="dashboard-editor-field"><span>Position</span><Select value={layer.anchor || "top-left"} onValueChange={(anchor) => updateTextLayer(layer.id, { anchor, x: TEXT_POSITIONS[anchor].x, y: TEXT_POSITIONS[anchor].y })}><SelectTrigger aria-label={`Text ${index + 1} position`}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TEXT_POSITIONS).map(([value, position]) => <SelectItem key={value} value={value}>{position.label}</SelectItem>)}</SelectContent></Select></label><label className="dashboard-editor-field"><span>Font family</span><Select value={layer.fontFamily || "sans-serif"} onValueChange={(fontFamily) => updateTextLayer(layer.id, { fontFamily })}><SelectTrigger aria-label={`Text ${index + 1} font family`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sans-serif">Sans serif</SelectItem><SelectItem value="serif">Serif</SelectItem><SelectItem value="monospace">Monospace</SelectItem><SelectItem value="Georgia">Georgia</SelectItem><SelectItem value="Arial">Arial</SelectItem><SelectItem value="system-ui">System</SelectItem></SelectContent></Select></label></div>
            <div className="dashboard-editor-grid"><label className="dashboard-editor-field"><span>Horizontal position <output>{layer.x}%</output></span><input type="range" min="0" max="100" value={layer.x} onChange={(event) => updateTextLayer(layer.id, { x: Number(event.target.value) })} /></label><label className="dashboard-editor-field"><span>Vertical position <output>{layer.y}%</output></span><input type="range" min="0" max="100" value={layer.y} onChange={(event) => updateTextLayer(layer.id, { y: Number(event.target.value) })} /></label></div>
            <div className="dashboard-editor-grid"><label className="dashboard-editor-field"><span>Font size <output>{layer.fontSize}px</output></span><input type="range" min="10" max="96" value={layer.fontSize} onChange={(event) => updateTextLayer(layer.id, { fontSize: Number(event.target.value) })} /></label><label className="dashboard-editor-field"><span>Font weight</span><Select value={String(layer.fontWeight || 600)} onValueChange={(fontWeight) => updateTextLayer(layer.id, { fontWeight: Number(fontWeight) })}><SelectTrigger aria-label={`Text ${index + 1} font weight`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="300">Light</SelectItem><SelectItem value="400">Regular</SelectItem><SelectItem value="500">Medium</SelectItem><SelectItem value="600">Semibold</SelectItem><SelectItem value="700">Bold</SelectItem><SelectItem value="800">Extra bold</SelectItem><SelectItem value="900">Black</SelectItem></SelectContent></Select></label></div>
            <div className="dashboard-editor-grid"><label className="dashboard-editor-field"><span>Style</span><Select value={layer.fontStyle || "normal"} onValueChange={(fontStyle) => updateTextLayer(layer.id, { fontStyle })}><SelectTrigger aria-label={`Text ${index + 1} style`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="normal">Normal</SelectItem><SelectItem value="italic">Italic</SelectItem></SelectContent></Select></label><label className="dashboard-editor-field"><span>Text color</span><input type="color" value={layer.color || "#ffffff"} onChange={(event) => updateTextLayer(layer.id, { color: event.target.value })} /></label></div>
            <label className="dashboard-editor-field"><span>Alignment</span><Select value={layer.align || "left"} onValueChange={(align) => updateTextLayer(layer.id, { align })}><SelectTrigger aria-label={`Text ${index + 1} alignment`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="left">Left</SelectItem><SelectItem value="center">Center</SelectItem><SelectItem value="right">Right</SelectItem></SelectContent></Select></label>
          </article>)}
        </section>
        {editor.type === "quickLinks" ? <section className="dashboard-quick-link-editor"><div className="dashboard-editor-section-heading"><div><strong>Quick links</strong><small>Add the destinations for this section.</small></div><Button type="button" variant="outline" size="sm" onClick={addQuickLink}><Plus size={14} /> Add link</Button></div>{editor.links.map((link, index) => <div className="dashboard-quick-link-fields" key={link.id}><span>{String(index + 1).padStart(2, "0")}</span><input value={link.label} onChange={(event) => updateQuickLink(link.id, { label: event.target.value })} placeholder="Link label" aria-label="Quick link label" /><input value={link.url} onChange={(event) => updateQuickLink(link.id, { url: event.target.value })} placeholder="/page or https://…" aria-label="Quick link URL" /><Button type="button" variant="ghost" size="icon" className="dashboard-container-delete" aria-label="Remove quick link" onClick={() => removeQuickLink(link.id)}><Trash2 size={14} /></Button></div>)}</section> : <div className="dashboard-editor-grid dashboard-cta-fields"><label className="dashboard-editor-field"><span>Button label <small>Optional</small></span><input value={editor.buttonLabel} onChange={(event) => updateEditor({ buttonLabel: event.target.value })} placeholder="Explore more" /></label><label className="dashboard-editor-field"><span>Button URL <small>Required with a label</small></span><input value={editor.buttonUrl} onChange={(event) => updateEditor({ buttonUrl: event.target.value })} placeholder="/projects or https://…" /></label></div>}
        {editor.images.some((image) => image.src && !safeImageUrl(image.src)) && <span className="dashboard-editor-error">Use a valid http(s) image URL or upload an image.</span>}
        {editor.buttonLabel && editor.buttonUrl && (!safeUrl(editor.buttonUrl)) && <span className="dashboard-editor-error">Use an app route such as /projects or a valid http(s) URL.</span>}
        {editor.links.some((link) => !safeUrl(link.url)) && <span className="dashboard-editor-error">Quick link URLs must be app paths or valid http(s) URLs.</span>}
      </div>
      <div className="dashboard-editor-actions"><Button type="button" variant="outline" onClick={() => setEditor(null)} disabled={imageBusy}>Cancel</Button><Button type="submit" disabled={imageBusy || !editorCanSave}><Check size={15} /> Save container</Button></div>
    </form></div>}
  </section>;
}
