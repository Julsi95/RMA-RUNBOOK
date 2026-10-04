import { useEffect, useState } from "react";
import { Network, Plus, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import OrgBranch from "@/features/organization/OrgBranch";
import OrgMemberDialog from "@/features/organization/OrgMemberDialog";
import { buildOrganizationTree, createMemberId, getOrganizationMembers, ORGANIZATION_STORAGE_KEY, organizationRoles } from "@/features/organization/organization-data";

export default function OrganizationPage() {
  const [members, setMembers] = useState(getOrganizationMembers);
  const [dialog, setDialog] = useState({ open: false, member: null });

  useEffect(() => {
    localStorage.setItem(ORGANIZATION_STORAGE_KEY, JSON.stringify(members));
  }, [members]);

  const tree = buildOrganizationTree(members);
  const roleCounts = organizationRoles.map((role) => ({ role, count: members.filter((member) => member.role === role).length }));

  function openAddDialog() {
    setDialog({ open: true, member: null });
  }

  function saveMember(memberData) {
    const id = memberData.id ?? createMemberId();
    const previous = members.find((person) => person.id === id);
    const savedMember = { ...memberData, id };
    setMembers((current) => {
      const updated = current.some((person) => person.id === id)
        ? current.map((person) => person.id === id ? savedMember : person)
        : [...current, savedMember];
      if (previous?.role === "Campaign Specialist" && savedMember.role !== "Campaign Specialist") {
        return updated.map((person) => person.mentorId === id ? { ...person, mentorId: null } : person);
      }
      return updated;
    });
    setDialog({ open: false, member: null });
  }

  function removeMember(member) {
    const confirmed = window.confirm(`Remove ${member.name} from the organization chart? Their direct reports will move to ${member.managerId ? "their manager" : "the top level"}.`);
    if (!confirmed) return;
    setMembers((current) => current
      .filter((person) => person.id !== member.id)
      .map((person) => ({
        ...person,
        managerId: person.managerId === member.id ? member.managerId ?? null : person.managerId,
        mentorId: person.mentorId === member.id ? null : person.mentorId,
      })));
  }

  return (
    <section className="page-content organization-page">
      <div className="page-heading organization-heading">
        <div>
          <p className="eyebrow">PEOPLE & STRUCTURE</p>
          <h1>Organizational chart</h1>
          <p className="page-description">See how your team fits together. Edit people, roles, and reporting lines.</p>
        </div>
        <Button onClick={openAddDialog}><Plus size={17} /> Add employee</Button>
      </div>

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
              {tree.map((root) => <OrgBranch key={root.id} member={root} onEdit={(member) => setDialog({ open: true, member })} onRemove={removeMember} />)}
            </div>
          </div>
        ) : (
          <div className="org-empty-state"><UsersRound size={24} /><h3>Your team is ready to grow</h3><p>Add a person to start building the reporting chart.</p><Button variant="outline" onClick={openAddDialog}><Plus size={16} /> Add first person</Button></div>
        )}
      </div>

      {dialog.open && <OrgMemberDialog member={dialog.member} members={members} onClose={() => setDialog({ open: false, member: null })} onSave={saveMember} />}
    </section>
  );
}
