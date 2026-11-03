import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Network, Plus, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import OrgBranch from "@/features/organization/OrgBranch";
import OrgMemberDialog from "@/features/organization/OrgMemberDialog";
import OrgProfileDialog from "@/features/organization/OrgProfileDialog";
import { buildOrganizationTree, createMemberId, getHierarchyRoles, getOperationalRoster, getReportingManagerIds, organizationHierarchyRoles } from "@/features/organization/organization-data";
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
  const [chartLines, setChartLines] = useState([]);

  const tree = buildOrganizationTree(members);
  const roleCounts = organizationHierarchyRoles.map((role) => ({ role, count: members.filter((member) => getHierarchyRoles(member).includes(role)).length }));
  const seniorAgentCount = members.filter((member) => member.role === "Senior Agent").length;
  const customerRepCount = members.filter((member) => member.role === "Customer Rep").length;
  const teamPeopleCount = getOperationalRoster(members).length;

  useEffect(() => {
    const viewport = chartRef.current;
    if (!viewport) return undefined;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const cards = new Map([...viewport.querySelectorAll("[data-org-person-id]")].map((card) => [card.dataset.orgPersonId, card]));
        const connectorRect = viewport.querySelector(".org-chart-connectors")?.getBoundingClientRect();
        if (!connectorRect) return;

        // Center each shared-report row on the measured midpoint of its two
        // managers. This keeps the layout aligned when card widths or report
        // counts change, without relying on fixed pixel coordinates.
        for (const groupElement of viewport.querySelectorAll("[data-co-managed-managers]")) {
          groupElement.style.removeProperty("--co-managed-center-offset");
          let managerIds = [];
          try { managerIds = JSON.parse(groupElement.dataset.coManagedManagers); } catch { /* ignore malformed chart metadata */ }
          const managerCenters = managerIds.map((id) => cards.get(id)).filter(Boolean).map((card) => {
            const bounds = card.getBoundingClientRect();
            return bounds.left + bounds.width / 2;
          }).sort((left, right) => left - right);
          if (managerCenters.length < 2) continue;
          const groupBounds = groupElement.getBoundingClientRect();
          const managersMidpoint = (managerCenters[0] + managerCenters[managerCenters.length - 1]) / 2;
          const groupMidpoint = groupBounds.left + groupBounds.width / 2;
          groupElement.style.setProperty("--co-managed-center-offset", `${managersMidpoint - groupMidpoint}px`);
        }

        const coManagedGroups = new Map();
        const directGroups = new Map();
        for (const member of members) {
          const managerIds = getReportingManagerIds(member);
          if (!managerIds.length) continue;
          if (managerIds.length > 1) {
            const normalizedManagerIds = [...managerIds].sort();
            const key = normalizedManagerIds.join(":");
            if (!coManagedGroups.has(key)) coManagedGroups.set(key, { key, managerIds: normalizedManagerIds, reports: [] });
            coManagedGroups.get(key).reports.push(member.id);
          } else {
            const managerId = managerIds[0];
            if (!directGroups.has(managerId)) directGroups.set(managerId, { key: managerId, reports: [] });
            directGroups.get(managerId).reports.push(member.id);
          }
        }
        const point = (element) => {
          const bounds = element.getBoundingClientRect();
          return {
            x: bounds.left + bounds.width / 2 - connectorRect.left,
            left: bounds.left - connectorRect.left,
            right: bounds.right - connectorRect.left,
            top: bounds.top - connectorRect.top,
            bottom: bounds.bottom - connectorRect.top,
            centerY: bounds.top + bounds.height / 2 - connectorRect.top,
          };
        };
        const directLines = [...directGroups.values()].flatMap((group) => {
          const managerCard = cards.get(group.key);
          const reports = group.reports.map((id) => cards.get(id)).filter(Boolean).map(point);
          if (!managerCard || !reports.length) return [];
          const manager = point(managerCard);
          const reportLeft = Math.min(...reports.map(({ x }) => x));
          const reportRight = Math.max(...reports.map(({ x }) => x));
          const reportTop = Math.min(...reports.map(({ top }) => top));
          const verticalGap = reportTop - manager.bottom;
          if (verticalGap <= 0) return [];
          const branchY = manager.bottom + verticalGap / 2;
          const paths = [{ id: `${group.key}-direct-stem`, d: `M ${manager.x} ${manager.bottom} V ${branchY}` }];
          if (reports.length > 1) paths.push({ id: `${group.key}-direct-branch`, d: `M ${reportLeft} ${branchY} H ${reportRight}` });
          reports.forEach(({ x, top }, index) => paths.push({ id: `${group.key}-direct-report-${index}`, d: `M ${x} ${branchY} V ${top}` }));
          return paths;
        });
        const coManagementLines = [...coManagedGroups.values()].flatMap((group) => {
          const managers = group.managerIds.map((id) => cards.get(id)).filter(Boolean).map(point).sort((left, right) => left.x - right.x);
          const reports = group.reports.map((id) => cards.get(id)).filter(Boolean).map(point).sort((left, right) => left.x - right.x);
          if (managers.length < 2 || !reports.length) return [];

          const managerBottom = Math.max(...managers.map(({ bottom }) => bottom));
          const reportTop = Math.min(...reports.map(({ top }) => top));
          const verticalGap = reportTop - managerBottom;
          if (verticalGap <= 0) return [];
          const branchStartY = managerBottom + verticalGap * 0.18;
          const junctionY = managerBottom + verticalGap * 0.48;
          const reportBranchY = managerBottom + verticalGap * 0.76;
          const managerCenter = (managers[0].x + managers[managers.length - 1].x) / 2;
          const reportLeft = reports[0].x;
          const reportRight = reports[reports.length - 1].x;
          const paths = managers.map(({ x, bottom }, index) => ({ id: `${group.key}-manager-${index}`, d: `M ${x} ${bottom} V ${branchStartY} L ${managerCenter} ${junctionY}` }));
          paths.push({ id: `${group.key}-trunk`, d: `M ${managerCenter} ${junctionY} V ${reportBranchY}` });
          paths.push({ id: `${group.key}-report-branch`, d: `M ${reportLeft} ${reportBranchY} H ${reportRight}` });
          reports.forEach(({ x, top }, index) => paths.push({ id: `${group.key}-report-${index}`, d: `M ${x} ${reportBranchY} V ${top}` }));
          return paths;
        });
        setChartLines([...directLines, ...coManagementLines]);
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    const treeNode = viewport.querySelector(".org-tree");
    if (treeNode) observer.observe(treeNode);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [members, loading]);

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
    const confirmed = window.confirm(`Remove ${member.name}? The employee and linked records can be recovered for 30 days. Direct reports will be reassigned to an available manager.`);
    if (!confirmed) return;
    const next = members
      .filter((person) => person.id !== member.id)
      .map((person) => {
        const currentManagers = getReportingManagerIds(person);
        const remainingManagers = currentManagers.filter((id) => id !== member.id);
        const reportingManagerIds = currentManagers.includes(member.id) && remainingManagers.length === 0
          ? getReportingManagerIds(member)
          : remainingManagers;
        return {
          ...person,
          reportingManagerIds,
          managerId: reportingManagerIds[0] ?? null,
          coManagerId: reportingManagerIds[1] ?? null,
          mentorId: person.mentorId === member.id ? null : person.mentorId,
        };
      });
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
        <section className="org-total-cards" aria-label="Organization overview">
          <h2>Organization overview</h2>
          <div className="org-total-cards-inner">
            <div className="org-total-card">
              <span className="org-total-icon"><UsersRound size={18} /></span>
              <span><strong>{members.length}</strong><small>people in organization</small></span>
            </div>
            <div className="org-total-card">
              <span className="org-total-icon"><UsersRound size={18} /></span>
              <span><strong>{teamPeopleCount}</strong><small>people in your team · TL/STL and below</small></span>
            </div>
            <div className="org-total-card">
              <span className="org-total-icon"><UsersRound size={18} /></span>
              <span><strong>{seniorAgentCount}</strong><small>senior agents</small></span>
            </div>
            <div className="org-total-card">
              <span className="org-total-icon"><UsersRound size={18} /></span>
              <span><strong>{customerRepCount}</strong><small>customer representatives</small></span>
            </div>
          </div>
        </section>
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
            <svg className="org-chart-connectors" aria-hidden="true" width={chartRef.current?.scrollWidth ?? "100%"} height={chartRef.current?.scrollHeight ?? "100%"}>{chartLines.map((line) => <path key={line.id} d={line.d} />)}</svg>
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
