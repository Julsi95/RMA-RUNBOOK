import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Network, Plus, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import OrgBranch from "@/features/organization/OrgBranch";
import OrgMemberDialog from "@/features/organization/OrgMemberDialog";
import OrgProfileDialog from "@/features/organization/OrgProfileDialog";
import { buildOrganizationTree, createMemberId, getHierarchyRoles, organizationHierarchyRoles } from "@/features/organization/organization-data";
import { useOrganizationRoster } from "@/app/organization-provider";
import { useAuth } from "@/app/auth-provider";

export default function OrganizationPage() {
  const { members, loading, error, saveMembers } = useOrganizationRoster();
  const { canEdit } = useAuth();
  const [dialog, setDialog] = useState({ open: false, member: null });
  const [profileMember, setProfileMember] = useState(null);
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const chartRef = useRef(null);
  const panRef = useRef(null);
  const [isPanning, setIsPanning] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const tree = buildOrganizationTree(members);
  const roleCounts = organizationHierarchyRoles.map((role) => ({ role, count: members.filter((member) => getHierarchyRoles(member).includes(role)).length }));

  useEffect(() => {
    if (!expanded) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event) { if (event.key === "Escape") setExpanded(false); }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [expanded]);

  function startChartPan(event) {
    if (event.pointerType !== "mouse" || event.button !== 0 || event.target.closest("button, a, input, textarea, select, .org-person-card")) return;
    const viewport = chartRef.current;
    if (!viewport) return;
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
    setIsPanning(true);
  }

  function moveChartPan(event) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId || !chartRef.current) return;
    chartRef.current.scrollLeft = pan.left - (event.clientX - pan.x);
    chartRef.current.scrollTop = pan.top - (event.clientY - pan.y);
  }

  function stopChartPan(event) {
    if (!panRef.current || panRef.current.pointerId !== event.pointerId) return;
    panRef.current = null;
    setIsPanning(false);
    if (chartRef.current?.hasPointerCapture(event.pointerId)) chartRef.current.releasePointerCapture(event.pointerId);
  }

  function openAddDialog() {
    setSaveError(""); setSaveMessage("");
    setDialog({ open: true, member: null });
  }

  async function saveMember(memberData) {
    const id = memberData.id ?? createMemberId();
    const creating = !members.some((person) => person.id === id);
    setSaveError(""); setSaveMessage("");
    const previous = members.find((person) => person.id === id);
    const savedMember = { ...memberData, id };
    let next = members.some((person) => person.id === id)
      ? members.map((person) => person.id === id ? savedMember : person)
      : [...members, savedMember];
    if (previous?.role === "Campaign Specialist" && savedMember.role !== "Campaign Specialist") {
      next = next.map((person) => person.mentorId === id ? { ...person, mentorId: null } : person);
    }
    await saveMembers(next);
    setDialog({ open: false, member: null });
    setSaveMessage(creating ? "Employee added successfully." : "Employee changes saved.");
  }

  async function removeMember(member) {
    const confirmed = window.confirm(`Remove ${member.name}? The employee and linked records can be recovered for 30 days. Direct reports will move to ${member.managerId ? "their manager" : "the top level"}.`);
    if (!confirmed) return;
    const next = members
      .filter((person) => person.id !== member.id)
      .map((person) => ({
        ...person,
        managerId: person.managerId === member.id ? member.managerId ?? null : person.managerId,
        mentorId: person.mentorId === member.id ? null : person.mentorId,
      }));
    try { await saveMembers(next, { deletedId: member.id }); setSaveError(""); }
    catch (cause) { setSaveError(cause.message || "Could not remove this employee."); }
  }

  return (
    <section className="page-content organization-page">
      <div className="page-heading organization-heading">
        <div>
          <p className="eyebrow">PEOPLE & STRUCTURE</p>
          <h1>Organizational chart</h1>
          <p className="page-description">Follow the reporting structure, assign leadership roles, and find your people.</p>
        </div>
        {canEdit && <Button onClick={openAddDialog}><Plus size={17} /> Add employee</Button>}
      </div>
      <div className="organization-notices">
        {loading && <p className="page-description" role="status">Loading team directory…</p>}
        {(error || saveError) && <p className="auth-error" role="alert">{saveError || error}</p>}
        {saveMessage && <p className="auth-success" role="status">{saveMessage}</p>}
      </div>

      <div className="org-summary-row">
        <div className="org-total-card">
          <span className="org-total-icon"><UsersRound size={18} /></span>
          <span><strong>{members.length}</strong><small>people in your team</small></span>
        </div>
        <div className="org-role-counts">
          <span className="org-role-counts-caption">LEADERSHIP HIERARCHY <small>People may hold more than one role</small></span>
          {roleCounts.map(({ role, count }, index) => (
            <div className="org-role-count" key={role}><span className="org-role-count-label"><small>{["OM", "TM", "STL", "TL"][index]}</small>{role.replace(/\s\([^)]*\)$/, "")}</span><strong>{count}</strong></div>
          ))}
        </div>
      </div>

      <div className={`org-chart-panel${expanded ? " is-expanded" : ""}`}>
        <div className="org-chart-heading">
          <div><span className="org-chart-icon"><Network size={17} /></span><div><h2>Team structure</h2><p>Reporting lines follow the manager selection. Role chips show each person’s hierarchy assignment.</p></div></div>
          <div className="org-chart-heading-actions">
            <span className="org-chart-live"><span /> Updated as you edit <small>Drag empty space or scroll to explore</small></span>
            <Button type="button" size="sm" variant="outline" aria-pressed={expanded} aria-label={expanded ? "Restore chart size" : "Expand chart to screen"} title={expanded ? "Restore chart size" : "Expand chart to screen"} onClick={() => setExpanded((value) => !value)}>
              {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{expanded ? "Restore" : "Expand"}
            </Button>
          </div>
        </div>
        {tree.length > 0 ? (
          <div ref={chartRef} className={`org-chart-viewport${isPanning ? " is-panning" : ""}`} role="region" aria-label="Organizational chart. Scroll or drag the empty chart area to explore." tabIndex={0} onPointerDown={startChartPan} onPointerMove={moveChartPan} onPointerUp={stopChartPan} onPointerCancel={stopChartPan}>
            <div className="org-tree">
              {tree.map((root) => <OrgBranch key={root.id} member={root} onEdit={(member) => setDialog({ open: true, member })} onRemove={removeMember} onOpenProfile={setProfileMember} canEdit={canEdit} />)}
            </div>
          </div>
        ) : (
          <div className="org-empty-state"><UsersRound size={24} /><h3>Your team is ready to grow</h3><p>{canEdit ? "Add a person to start building the reporting chart." : "The team directory is empty."}</p>{canEdit && <Button variant="outline" onClick={openAddDialog}><Plus size={16} /> Add first person</Button>}</div>
        )}
      </div>

      {dialog.open && <OrgMemberDialog member={dialog.member} members={members} onClose={() => setDialog({ open: false, member: null })} onSave={saveMember} />}
      <OrgProfileDialog member={profileMember} onClose={() => setProfileMember(null)} />
    </section>
  );
}
