import { useState } from "react";
import { Network, Plus, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import OrgBranch from "@/features/organization/OrgBranch";
import OrgMemberDialog from "@/features/organization/OrgMemberDialog";
import { buildOrganizationTree, createMemberId, organizationRoles } from "@/features/organization/organization-data";
import { useOrganizationRoster } from "@/app/organization-provider";
import { useAuth } from "@/app/auth-provider";

export default function OrganizationPage() {
  const { members, loading, error, saveMembers } = useOrganizationRoster();
  const { canEdit } = useAuth();
  const [dialog, setDialog] = useState({ open: false, member: null });
  const [saveError, setSaveError] = useState("");

  const tree = buildOrganizationTree(members);
  const roleCounts = organizationRoles.map((role) => ({ role, count: members.filter((member) => member.role === role).length }));

  function openAddDialog() {
    setDialog({ open: true, member: null });
  }

  async function saveMember(memberData) {
    const id = memberData.id ?? createMemberId();
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
          <p className="page-description">See how your team fits together. Edit people, roles, and reporting lines.</p>
        </div>
        {canEdit && <Button onClick={openAddDialog}><Plus size={17} /> Add employee</Button>}
      </div>
      {loading && <p className="page-description" role="status">Loading team directory…</p>}
      {(error || saveError) && <p className="auth-error" role="alert">{saveError || error}</p>}

      <div className="org-summary-row">
        <div className="org-total-card">
          <span className="org-total-icon"><UsersRound size={18} /></span>
          <span><strong>{members.length}</strong><small>people in your team</small></span>
        </div>
        <div className="org-role-counts">
          {roleCounts.map(({ role, count }) => (
            <div className="org-role-count" key={role}><span>{role}</span><strong>{count}</strong></div>
          ))}
        </div>
      </div>

      <div className="org-chart-panel">
        <div className="org-chart-heading">
          <div><span className="org-chart-icon"><Network size={17} /></span><div><h2>Team structure</h2><p>Solid lines show the primary manager. Mentor names appear beneath Customer Reps.</p></div></div>
          <span className="org-chart-live"><span /> Updated as you edit</span>
        </div>
        {tree.length > 0 ? (
          <div className="org-chart-viewport">
            <div className="org-tree">
              {tree.map((root) => <OrgBranch key={root.id} member={root} onEdit={(member) => setDialog({ open: true, member })} onRemove={removeMember} canEdit={canEdit} />)}
            </div>
          </div>
        ) : (
          <div className="org-empty-state"><UsersRound size={24} /><h3>Your team is ready to grow</h3><p>{canEdit ? "Add a person to start building the reporting chart." : "The team directory is empty."}</p>{canEdit && <Button variant="outline" onClick={openAddDialog}><Plus size={16} /> Add first person</Button>}</div>
        )}
      </div>

      {dialog.open && <OrgMemberDialog member={dialog.member} members={members} onClose={() => setDialog({ open: false, member: null })} onSave={saveMember} />}
    </section>
  );
}
