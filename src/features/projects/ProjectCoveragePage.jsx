import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, BadgeCheck, BriefcaseBusiness, Check, ChevronDown, CircleHelp, ClipboardList,
  Edit3, GraduationCap, LayoutGrid, List, Plus, Search, ShieldCheck, Trash2, UsersRound, X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { useOrganizationRoster } from "@/app/organization-provider";
import { getOperationalRoster } from "@/features/organization/organization-data";
import { useAuth } from "@/app/auth-provider";
import { isSupabaseConfigured } from "@/lib/supabase";
import { loadProjectCoverage, saveProjectCoverage } from "@/lib/backend-repositories";
import { retryDataLoad, subscribeToTables } from "@/lib/backend/shared";
import { fetchCachedQuery, queryClient, queryKeys, readCachedQuery } from "@/lib/backend/query-cache";
import {
  createProjectId, getSavedProjects, PROJECT_COVERAGE_STORAGE_KEY, PROJECT_STATUSES,
} from "@/features/projects/project-data";
import "@/features/projects/project-coverage.css";

const STATUS_OPTIONS = [{ id: "none", label: "Not assigned" }, ...PROJECT_STATUSES];

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function MemberAvatar({ member, small = false }) {
  return <span className={`coverage-avatar ${small ? "coverage-avatar-small" : ""}`}>{member?.photo ? <img src={member.photo} alt="" /> : initials(member?.name)}</span>;
}

function projectCounts(project) {
  const assignments = Object.values(project.assignments ?? {});
  return {
    trained: assignments.filter((status) => status === "trained").length,
    refresher: assignments.filter((status) => status === "refresher").length,
    toTrain: assignments.filter((status) => status === "to-train").length,
    assigned: assignments.filter(Boolean).length,
  };
}

function ProjectDialog({ project, members, onClose, onSave, onRemove }) {
  const [draft, setDraft] = useState(() => project ?? { name: "", description: "", isActive: true, pocId: "", trainerIds: [], assignments: {} });
  const [pocSearch, setPocSearch] = useState("");
  const [error, setError] = useState("");
  const isEditing = Boolean(project?.id);
  const hasHistory = Boolean(project && (Object.keys(project.assignments ?? {}).length || project.pocId || project.trainerIds?.length));

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    setError("");
  }

  function toggleTrainer(memberId) {
    setDraft((current) => ({
      ...current,
      trainerIds: current.trainerIds.includes(memberId)
        ? current.trainerIds.filter((id) => id !== memberId)
        : [...current.trainerIds, memberId],
    }));
  }

  function submit(event) {
    event.preventDefault();
    if (!draft.name.trim()) { setError("Enter a project name."); return; }
    onSave({ ...draft, name: draft.name.trim(), description: draft.description.trim() });
  }

  function removeProject() {
    const action = hasHistory ? "archive" : "permanently remove";
    if (window.confirm(`${hasHistory ? "Archive" : "Permanently remove"} ${project.name}? ${hasHistory ? "Its coverage records will be kept." : "This project has no assignments or project contacts."}`)) onRemove(project, hasHistory);
  }

  return (
    <div className="coverage-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="coverage-dialog coverage-project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
        <header className="coverage-dialog-head"><div><span className="coverage-dialog-icon"><BriefcaseBusiness size={17} /></span><div><p className="coverage-kicker">PROJECT SETUP</p><h2 id="project-dialog-title">{isEditing ? "Edit project" : "Add project"}</h2><p>Set the project contacts and whether it is available for new assignments.</p></div></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog"><X size={17} /></Button></header>
        <form onSubmit={submit} className="coverage-dialog-form">
          <label className="coverage-field"><span>Project name</span><input autoFocus value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="e.g. RMA Callback" maxLength={90} /></label>
          <label className="coverage-field"><span>Description <small>Optional</small></span><textarea value={draft.description} onChange={(event) => update("description", event.target.value)} placeholder="What does this project cover?" rows={2} maxLength={240} /></label>
          <div className="coverage-field"><span>POC · Primary contact</span><input type="search" value={pocSearch} onChange={(event) => setPocSearch(event.target.value)} placeholder="Search employee name" aria-label="Search primary contact by name" /><Select value={draft.pocId || "none"} onValueChange={(value) => update("pocId", value === "none" ? "" : value)}><SelectTrigger aria-label="Project primary contact"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No POC selected</SelectItem>{members.filter((member) => member.id === draft.pocId || `${member.name} ${member.role}`.toLowerCase().includes(pocSearch.trim().toLowerCase())).map((member) => <SelectItem value={member.id} key={member.id}>{member.name} · {member.role}</SelectItem>)}</SelectContent></Select><small className="coverage-field-help">The main person responsible for this project. A POC can also be a trainer.</small></div>
          <fieldset className="coverage-trainer-field"><legend><span>Trainers</span><small>People who can train or coach teammates on this project</small></legend>{members.length ? <div className="coverage-trainer-list">{members.map((member) => <label className="coverage-trainer-option" key={member.id}><input type="checkbox" checked={draft.trainerIds.includes(member.id)} onChange={() => toggleTrainer(member.id)} /><MemberAvatar member={member} small /><span className="coverage-trainer-copy"><strong>{member.name}</strong><small>{member.role}</small></span>{draft.pocId === member.id && <em>POC</em>}</label>)}</div> : <p className="coverage-muted">Add team members in Organizational chart before choosing trainers.</p>}</fieldset>
          <label className="coverage-active-toggle"><span className="coverage-toggle-copy"><strong>Project is active</strong><small>Inactive projects are kept for reference and can’t receive new status updates.</small></span><input type="checkbox" checked={draft.isActive} onChange={(event) => update("isActive", event.target.checked)} /><i /></label>
          <p className="coverage-help-callout"><CircleHelp size={15} /> POC and trainer roles do not automatically mark someone as trained. Set each person’s training status in the coverage matrix.</p>
          {error && <p className="coverage-form-error">{error}</p>}
          <footer className="coverage-dialog-actions">{isEditing && <Button type="button" variant="outline" className="coverage-danger-action" onClick={removeProject}>{hasHistory ? <Archive size={14} /> : <Trash2 size={14} />}{hasHistory ? "Archive project" : "Remove project"}</Button>}<span /><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit"><Check size={15} /> {isEditing ? "Save project" : "Add project"}</Button></footer>
        </form>
      </section>
    </div>
  );
}

function AssignmentDialog({ member, project, status, onClose, onSave, onRemove }) {
  const [nextStatus, setNextStatus] = useState(status || "none");
  const assigned = Boolean(status);
  return (
    <div className="coverage-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="coverage-dialog coverage-assignment-dialog" role="dialog" aria-modal="true" aria-labelledby="assignment-dialog-title">
        <header className="coverage-dialog-head"><div><span className="coverage-dialog-icon"><ClipboardList size={17} /></span><div><p className="coverage-kicker">TEAM COVERAGE</p><h2 id="assignment-dialog-title">{assigned ? "Update assignment" : "Assign person"}</h2><p>Choose {member.name}’s training status for this project.</p></div></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog"><X size={17} /></Button></header>
        <div className="coverage-assignment-person"><MemberAvatar member={member} /><div><strong>{member.name}</strong><small>{member.role}</small></div><span className="coverage-assignment-project">{project.name}</span></div>
        <label className="coverage-field"><span>Training status</span><Select value={nextStatus} onValueChange={setNextStatus}><SelectTrigger aria-label="Training status"><SelectValue /></SelectTrigger><SelectContent>{STATUS_OPTIONS.map((option) => <SelectItem value={option.id} key={option.id}>{option.label}</SelectItem>)}</SelectContent></Select></label>
        <p className="coverage-field-help">“Not assigned” removes this person from the project coverage list. It does not remove the person or project.</p>
        <footer className="coverage-dialog-actions">{assigned && <Button variant="outline" className="coverage-danger-action" onClick={onRemove}><Trash2 size={14} /> Remove from project</Button>}<span /><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => nextStatus === "none" ? onRemove() : onSave(nextStatus)}><Check size={15} /> Save status</Button></footer>
      </section>
    </div>
  );
}

function StatusCell({ status, onClick, disabled }) {
  const info = PROJECT_STATUSES.find((option) => option.id === status);
  return <button type="button" className={`coverage-status-cell ${status ? `coverage-status-${status}` : "coverage-status-empty"}`} onClick={onClick} disabled={disabled} aria-label={status ? `${info.label}. Edit training status` : "Not assigned. Add person to project"} title={disabled ? "Archived project" : status ? `${info.label} · click to edit` : "Add to project"}>
    {status ? <><span className="coverage-status-icon">{status === "trained" ? <BadgeCheck size={13} /> : status === "refresher" ? <ShieldCheck size={13} /> : <GraduationCap size={13} />}</span><span>{info.label}</span><Edit3 className="coverage-status-edit" size={12} /></> : <><Plus size={13} /><span>Assign</span></>}
  </button>;
}

export default function ProjectCoveragePage() {
  const { canEdit, user } = useAuth();
  const resourceKey = useMemo(() => queryKeys.projectCoverage(user?.id ?? "anonymous", canEdit), [canEdit, user?.id]);
  const cachedProjects = readCachedQuery(resourceKey);
  const [projects, setProjects] = useState(() => isSupabaseConfigured ? cachedProjects ?? [] : getSavedProjects());
  const [remoteReady, setRemoteReady] = useState(Boolean(cachedProjects));
  const [syncError, setSyncError] = useState("");
  const remoteSnapshotRef = useRef(cachedProjects ? structuredClone(cachedProjects) : null);
  const { members: rosterMembers } = useOrganizationRoster();
  const members = useMemo(() => getOperationalRoster(rosterMembers), [rosterMembers]);
  const canManage = canEdit && (!isSupabaseConfigured || Boolean(remoteSnapshotRef.current));
  const [view, setView] = useState("matrix");
  const [search, setSearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(true);
  const [projectDialog, setProjectDialog] = useState(null);
  const [assignmentDialog, setAssignmentDialog] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    void fetchCachedQuery(resourceKey, () => retryDataLoad(loadProjectCoverage)).then((saved) => {
      if (!active) return;
      remoteSnapshotRef.current = structuredClone(saved);
      setProjects(saved);
      setRemoteReady(true);
      setSyncError("");
    }).catch((error) => { if (active) { setSyncError(error.message || "Could not load project coverage."); setRemoteReady(true); } });
    return () => { active = false; };
  }, [resourceKey]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    let timer;
    const unsubscribe = subscribeToTables(["projects", "project_trainers", "project_assignments"], () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void fetchCachedQuery(resourceKey, () => retryDataLoad(loadProjectCoverage), { force: true }).then((saved) => {
        if (!active) return;
        remoteSnapshotRef.current = structuredClone(saved); setProjects(saved); setSyncError("");
      }).catch((error) => { if (active) setSyncError(error.message || "Could not sync project coverage."); }); }, 180);
    }, "project-coverage");
    return () => { active = false; window.clearTimeout(timer); unsubscribe(); };
  }, [resourceKey]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      localStorage.setItem(PROJECT_COVERAGE_STORAGE_KEY, JSON.stringify(projects));
      return undefined;
    }
    if (!remoteReady || !canEdit || !remoteSnapshotRef.current || JSON.stringify(projects) === JSON.stringify(remoteSnapshotRef.current)) return undefined;
    const next = structuredClone(projects);
    const timeout = window.setTimeout(async () => {
      try {
        await saveProjectCoverage(next);
        remoteSnapshotRef.current = next;
        queryClient.setQueryData(resourceKey, next);
        setSyncError("");
      } catch (error) { setSyncError(error.message || "Could not save project coverage."); }
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [projects, remoteReady, canEdit, resourceKey]);

  const visibleProjects = useMemo(() => projects.filter((project) => {
    const matchesArchive = showArchived || project.isActive;
    const matchesSearch = `${project.name} ${project.description}`.toLowerCase().includes(search.trim().toLowerCase());
    return matchesArchive && matchesSearch;
  }), [projects, search, showArchived]);

  const visibleMembers = useMemo(() => members.filter((member) => {
    const matchesPerson = `${member.name} ${member.role}`.toLowerCase().includes(memberSearch.trim().toLowerCase());
    const matchesStatus = statusFilter === "all" || visibleProjects.some((project) => project.assignments?.[member.id] === statusFilter);
    return matchesPerson && matchesStatus;
  }), [members, memberSearch, statusFilter, visibleProjects]);

  const activeProjects = projects.filter((project) => project.isActive);
  const toTrainCount = activeProjects.reduce((sum, project) => sum + projectCounts(project).toTrain, 0);
  const refresherCount = activeProjects.reduce((sum, project) => sum + projectCounts(project).refresher, 0);
  const uncoveredProjects = activeProjects.filter((project) => !project.pocId).length;

  function saveProject(draft) {
    if (!canEdit || (isSupabaseConfigured && !remoteSnapshotRef.current)) return;
    if (draft.id) setProjects((current) => current.map((project) => project.id === draft.id ? draft : project));
    else setProjects((current) => [...current, { ...draft, id: createProjectId() }]);
    setProjectDialog(null);
  }

  function removeProject(project, archive) {
    if (!canEdit || (isSupabaseConfigured && !remoteSnapshotRef.current)) return;
    if (archive) setProjects((current) => current.map((item) => item.id === project.id ? { ...item, isActive: false } : item));
    else setProjects((current) => current.filter((item) => item.id !== project.id));
    setProjectDialog(null);
  }

  function saveAssignment(status) {
    if (!canEdit || (isSupabaseConfigured && !remoteSnapshotRef.current)) return;
    const { project, member } = assignmentDialog;
    setProjects((current) => current.map((item) => item.id === project.id ? { ...item, assignments: { ...item.assignments, [member.id]: status } } : item));
    setAssignmentDialog(null);
  }

  function removeAssignment() {
    if (!canEdit || (isSupabaseConfigured && !remoteSnapshotRef.current)) return;
    const { project, member } = assignmentDialog;
    setProjects((current) => current.map((item) => {
      if (item.id !== project.id) return item;
      const assignments = { ...item.assignments };
      delete assignments[member.id];
      return { ...item, assignments };
    }));
    setAssignmentDialog(null);
  }

  function openAssignment(project, member) {
    if (!canEdit || !project.isActive) return;
    setAssignmentDialog({ project, member, status: project.assignments?.[member.id] ?? "" });
  }

  function getMember(memberId) {
    return members.find((member) => member.id === memberId);
  }

  return (
    <section className="page-content project-coverage-page">
      <div className="page-heading project-coverage-heading">
        <div><p className="eyebrow">ADMIN · OPERATIONS</p><h1>Project coverage</h1><p className="page-description">Manage project contacts, trainers, and each team member’s training coverage.</p></div>
        {canManage && <Button onClick={() => setProjectDialog({ project: null })}><Plus size={16} /> Add project</Button>}
      </div>
      {syncError && <p className="auth-error" role="alert">{syncError}</p>}

      <div className="coverage-summary-grid">
        <article><span className="coverage-summary-icon"><BriefcaseBusiness size={17} /></span><div><small>ACTIVE PROJECTS</small><strong>{activeProjects.length}</strong><span>{projects.length - activeProjects.length} archived</span></div></article>
        <article><span className="coverage-summary-icon"><UsersRound size={17} /></span><div><small>TEAM MEMBERS</small><strong>{members.length}</strong><span>Available for project coverage</span></div></article>
        <article className={toTrainCount ? "coverage-summary-attention" : ""}><span className="coverage-summary-icon"><GraduationCap size={17} /></span><div><small>NEEDS TRAINING</small><strong>{toTrainCount}</strong><span>Project assignments to train</span></div></article>
        <article className={refresherCount ? "coverage-summary-attention" : ""}><span className="coverage-summary-icon"><ShieldCheck size={17} /></span><div><small>REFRESHERS</small><strong>{refresherCount}</strong><span>People needing refreshers</span></div></article>
      </div>

      <section className="coverage-workspace">
        <div className="coverage-toolbar">
          <div className="coverage-toolbar-copy"><div><p className="coverage-kicker">PROJECT ROSTER</p><h2>Team training matrix</h2></div><span className="coverage-live-indicator"><i />{isSupabaseConfigured ? remoteReady ? canEdit ? "Shared workspace" : "Published data" : "Loading projects…" : "Saved in this browser"}</span></div>
          <div className="coverage-toolbar-controls">
            <label className="coverage-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find project" aria-label="Find project" /></label>
            <label className="coverage-search"><Search size={14} /><input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="Find person" aria-label="Find person" /></label>
            <label className="coverage-filter-select"><span className="sr-only">Filter by training status</span><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger aria-label="Filter people by training status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All team statuses</SelectItem>{PROJECT_STATUSES.map((status) => <SelectItem key={status.id} value={status.id}>{status.label}</SelectItem>)}</SelectContent></Select></label>
            <button type="button" className={`coverage-archive-toggle ${showArchived ? "is-on" : ""}`} onClick={() => setShowArchived((current) => !current)}><Archive size={13} /> Archived</button>
            <div className="coverage-view-toggle" role="group" aria-label="Project page view"><button type="button" className={view === "matrix" ? "is-active" : ""} onClick={() => setView("matrix")} aria-label="Matrix view" title="Matrix view"><LayoutGrid size={15} /></button><button type="button" className={view === "projects" ? "is-active" : ""} onClick={() => setView("projects")} aria-label="Project cards view" title="Project cards view"><List size={15} /></button></div>
          </div>
        </div>

        <div className="coverage-legend"><span><i className="legend-trained" />Trained</span><span><i className="legend-refresher" />Refresher</span><span><i className="legend-to-train" />To be trained</span><span><i className="legend-empty" />Not assigned</span><span className="coverage-legend-hint">Select a matrix cell to assign, update, or remove someone.</span></div>

        {view === "matrix" ? (
          <div className="coverage-matrix-scroll" role="region" aria-label="Project coverage matrix" tabIndex={0}>
            {visibleProjects.length ? <div className="coverage-matrix" style={{ "--coverage-project-count": visibleProjects.length }}>
              <div className="coverage-matrix-header coverage-matrix-row"><div className="coverage-matrix-person-header"><UsersRound size={14} /><span>TEAM MEMBER</span><small>{visibleMembers.length} shown</small></div>{visibleProjects.map((project, index) => {
                const poc = getMember(project.pocId);
                const trainers = project.trainerIds.map(getMember).filter(Boolean);
                const count = projectCounts(project);
                return <div className={`coverage-project-header ${project.isActive ? "" : "is-archived"}`} key={project.id}>
                  <div className="coverage-project-head-main"><span className="coverage-project-number">{String(index + 1).padStart(2, "0")}</span><div><strong title={project.name}>{project.name}</strong><small>{project.isActive ? "ACTIVE PROJECT" : "ARCHIVED"}</small></div>{canManage && <button type="button" onClick={() => setProjectDialog({ project })} title={`Edit ${project.name}`} aria-label={`Edit ${project.name}`}><Edit3 size={13} /></button>}</div>
                  <div className="coverage-project-contacts"><span><b>POC</b>{poc?.name ?? <em>Not set</em>}</span><span><b>TRAINER{trainers.length === 1 ? "" : "S"}</b>{trainers.length ? trainers.map((person) => person.name).join(", ") : <em>Not set</em>}</span></div>
                  <div className="coverage-project-count"><span><BadgeCheck size={11} /> {count.trained} trained</span><span><GraduationCap size={11} /> {count.toTrain} to train</span></div>
                </div>;
              })}</div>
              {visibleMembers.map((member) => <div className="coverage-matrix-row" key={member.id}><div className="coverage-person-cell"><MemberAvatar member={member} /><span><strong>{member.name}</strong><small>{member.role}</small></span><span className="coverage-person-project-count">{visibleProjects.filter((project) => Boolean(project.assignments?.[member.id])).length}</span></div>{visibleProjects.map((project) => <div className={`coverage-matrix-cell ${project.isActive ? "" : "is-archived"}`} key={`${member.id}-${project.id}`}><StatusCell status={project.assignments?.[member.id]} disabled={!canManage || !project.isActive} onClick={() => openAssignment(project, member)} /></div>)}</div>)}
            </div> : <div className="coverage-empty-state"><BriefcaseBusiness size={24} /><h3>No projects match</h3><p>Add a project or change your search to see team coverage.</p>{canManage && <Button onClick={() => setProjectDialog({ project: null })}><Plus size={15} /> Add project</Button>}</div>}
          </div>
        ) : (
          <div className="coverage-project-cards">{visibleProjects.length ? visibleProjects.map((project, index) => {
            const counts = projectCounts(project);
            const poc = getMember(project.pocId);
            const trainers = project.trainerIds.map(getMember).filter(Boolean);
            return <article className={`coverage-project-card ${project.isActive ? "" : "is-archived"}`} key={project.id}>
              <header><span className="coverage-project-number">{String(index + 1).padStart(2, "0")}</span><span className="coverage-project-card-state">{project.isActive ? "Active" : "Archived"}</span>{canManage && <button type="button" onClick={() => setProjectDialog({ project })} aria-label={`Edit ${project.name}`}><Edit3 size={14} /></button>}</header>
              <h3>{project.name}</h3><p>{project.description || "No project description added."}</p>
              <div className="coverage-card-contacts"><div><span>POC</span><strong>{poc?.name ?? "Not assigned"}</strong></div><div><span>TRAINER{trainers.length === 1 ? "" : "S"}</span><strong>{trainers.length ? trainers.map((person) => person.name).join(", ") : "Not assigned"}</strong></div></div>
              <div className="coverage-card-stats"><span><BadgeCheck size={13} /> {counts.trained} trained</span><span><ShieldCheck size={13} /> {counts.refresher} refreshers</span><span><GraduationCap size={13} /> {counts.toTrain} to train</span></div>
              <footer><span>{counts.assigned} of {members.length} people assigned</span>{canManage && <button type="button" onClick={() => setProjectDialog({ project })}>Manage project <ChevronDown size={13} /></button>}</footer>
            </article>;
          }) : <div className="coverage-empty-state"><BriefcaseBusiness size={24} /><h3>Your project list is ready</h3><p>{canManage ? "Add a project, then choose its POC, trainers, and team training statuses." : "No projects are published yet."}</p>{canManage && <Button onClick={() => setProjectDialog({ project: null })}><Plus size={15} /> Add first project</Button>}</div>}</div>
        )}

        <div className="coverage-workspace-footer"><span><ShieldCheck size={14} /> POC and Trainer labels are project-specific. A person’s training status is tracked separately.</span><span>{uncoveredProjects ? `${uncoveredProjects} active project${uncoveredProjects === 1 ? " has" : "s have"} no POC yet` : "Every active project has a POC"}</span></div>
      </section>

      {projectDialog && canManage && <ProjectDialog key={projectDialog.project?.id ?? "new-project"} project={projectDialog.project} members={members} onClose={() => setProjectDialog(null)} onSave={saveProject} onRemove={removeProject} />}
      {assignmentDialog && canManage && <AssignmentDialog key={`${assignmentDialog.project.id}-${assignmentDialog.member.id}`} member={assignmentDialog.member} project={assignmentDialog.project} status={assignmentDialog.status} onClose={() => setAssignmentDialog(null)} onSave={saveAssignment} onRemove={removeAssignment} />}
    </section>
  );
}
