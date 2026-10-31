import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Network, Plus, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import OrgBranch from "@/features/organization/OrgBranch";
import OrgMemberDialog from "@/features/organization/OrgMemberDialog";
import OrgProfileDialog from "@/features/organization/OrgProfileDialog";
import { buildOrganizationTree, createMemberId, getHierarchyRoles, getOperationalRoster, organizationHierarchyRoles } from "@/features/organization/organization-data";
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
  const teamPeopleCount = getOperationalRoster(members).length;

  useEffect(() => {
    const viewport = chartRef.current;
    if (!viewport) return undefined;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const cards = new Map([...viewport.querySelectorAll("[data-org-person-id]")].map((card) => [card.dataset.orgPersonId, card]));
        const rect = viewport.getBoundingClientRect();
        const sharedGroups = new Map();
        const directGroups = new Map();
        for (const member of members) {
          if (!member.managerId) continue;
          if (member.coManagerId) {
            const managerIds = [member.managerId, member.coManagerId].sort();
            const key = managerIds.join(":");
            if (!sharedGroups.has(key)) sharedGroups.set(key, { key, managerIds, reports: [] });
            sharedGroups.get(key).reports.push(member.id);
          } else {
            if (!directGroups.has(member.managerId)) directGroups.set(member.managerId, { key: member.managerId, reports: [] });
            directGroups.get(member.managerId).reports.push(member.id);
          }
        }
        const point = (element) => {
          const bounds = element.getBoundingClientRect();
          return {
            x: bounds.left + bounds.width / 2 - rect.left + viewport.scrollLeft,
            left: bounds.left - rect.left + viewport.scrollLeft,
            right: bounds.right - rect.left + viewport.scrollLeft,
            top: bounds.top - rect.top + viewport.scrollTop,
            bottom: bounds.bottom - rect.top + viewport.scrollTop,
            centerY: bounds.top + bounds.height / 2 - rect.top + viewport.scrollTop,
          };
        };
        const directLines = [...directGroups.values()].flatMap((group) => {
          const managerCard = cards.get(group.key);
          const reports = group.reports.map((id) => cards.get(id)).filter(Boolean).map(point);
          if (!managerCard || !reports.length) return [];
          const manager = point(managerCard);
          const reportLeft = Math.min(...reports.map(({ x }) => x));
          const reportRight = Math.max(...reports.map(({ x }) => x));
          const branchY = Math.min(...reports.map(({ top }) => top)) - 18;
          const paths = [{ id: `${group.key}-direct-stem`, d: `M ${manager.x} ${manager.bottom} V ${branchY}` }];
          if (reports.length > 1) paths.push({ id: `${group.key}-direct-branch`, d: `M ${reportLeft} ${branchY} H ${reportRight}` });
          reports.forEach(({ x, top }, index) => paths.push({ id: `${group.key}-direct-report-${index}`, d: `M ${x} ${branchY} V ${top}` }));
          return paths;
        });
        const coManagementLines = [...sharedGroups.values()].flatMap((group) => {
          const managers = group.managerIds.map((id) => cards.get(id)).filter(Boolean).map(point);
          const reports = group.reports.map((id) => cards.get(id)).filter(Boolean).map(point);
          if (managers.length !== 2 || !reports.length) return [];

          const reportBranchY = Math.min(...reports.map(({ top }) => top)) - 18;
          const reportLeft = Math.min(...reports.map(({ x }) => x));
          const reportRight = Math.max(...reports.map(({ x }) => x));
          const horizontalOverlap = Math.abs(managers[0].x - managers[1].x) < (managers[0].right - managers[0].left + managers[1].right - managers[1].left) / 2 + 12;
          if (horizontalOverlap) {
            const routeX = Math.max(...managers.map(({ right }) => right)) + 20;
            const topManagerY = Math.min(...managers.map(({ centerY }) => centerY));
            const lowerManagerY = Math.max(...managers.map(({ centerY }) => centerY));
            const paths = managers.map(({ right, centerY }, index) => ({ id: `${group.key}-manager-${index}`, d: `M ${right} ${centerY} H ${routeX}` }));
            paths.push({ id: `${group.key}-pair`, d: `M ${routeX} ${topManagerY} V ${lowerManagerY}` });
            if (reportBranchY > lowerManagerY) {
              paths.push({ id: `${group.key}-trunk`, d: `M ${routeX} ${lowerManagerY} V ${reportBranchY}` });
              paths.push({ id: `${group.key}-report-branch`, d: `M ${reportLeft} ${reportBranchY} H ${reportRight}` });
              reports.forEach(({ x, top }, index) => paths.push({ id: `${group.key}-report-${index}`, d: `M ${x} ${reportBranchY} V ${top}` }));
            } else {
              reports.forEach(({ x, top }, index) => paths.push({ id: `${group.key}-report-${index}`, d: `M ${routeX} ${lowerManagerY} V ${top - 8} H ${x} V ${top}` }));
            }
            return paths;
          }

          const managerLeft = Math.min(...managers.map(({ x }) => x));
          const managerRight = Math.max(...managers.map(({ x }) => x));
          const managerCenter = (managerLeft + managerRight) / 2;
          const pairY = Math.max(...managers.map(({ bottom }) => bottom)) + 20;
          const paths = managers.map(({ x, bottom }, index) => ({ id: `${group.key}-manager-${index}`, d: `M ${x} ${bottom} V ${pairY}` }));
          paths.push({ id: `${group.key}-pair`, d: `M ${managerLeft} ${pairY} H ${managerRight}` });

          if (reportBranchY > pairY) {
            paths.push({ id: `${group.key}-trunk`, d: `M ${managerCenter} ${pairY} V ${reportBranchY}` });
            paths.push({ id: `${group.key}-report-branch`, d: `M ${reportLeft} ${reportBranchY} H ${reportRight}` });
            reports.forEach(({ x, top }, index) => paths.push({ id: `${group.key}-report-${index}`, d: `M ${x} ${reportBranchY} V ${top}` }));
          } else {
            reports.forEach(({ x, top }, index) => {
              const routingY = top - 8;
              paths.push({ id: `${group.key}-report-${index}`, d: `M ${managerCenter} ${pairY} V ${routingY} H ${x} V ${top}` });
            });
          }
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
    const confirmed = window.confirm(`Remove ${member.name}? The employee and linked records can be recovered for 30 days. Direct reports will move to ${member.managerId ? "their manager" : "the top level"}.`);
    if (!confirmed) return;
    const next = members
      .filter((person) => person.id !== member.id)
      .map((person) => ({
        ...person,
        managerId: person.managerId === member.id ? member.managerId ?? null : person.managerId,
        coManagerId: person.coManagerId === member.id || person.managerId === member.id ? null : person.coManagerId,
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
