import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { getOrganizationRoleLabels, getHierarchyRoles } from "@/features/organization/organization-data";

function getInitials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

export default function OrgBranch({ member, onEdit, onRemove, onOpenProfile, canEdit = true }) {
  return (
    <div className="org-branch">
      <article className="org-person-card">
        <button className="org-person-card-main" type="button" onClick={() => onOpenProfile(member)} aria-label={`View ${member.name}'s profile`} title={`View ${member.name}'s profile`}>
          <span className="member-avatar">
            {member.photo ? <img src={member.photo} alt="" /> : <span>{getInitials(member.name)}</span>}
          </span>
          <span className="org-person-details">
            <span className="org-person-name" title={member.name}>{member.name}</span>
            <span className="org-person-role-list">{getOrganizationRoleLabels(member).map((role, index) => <span className={`org-role-chip org-role-chip-${getHierarchyRoles(member).includes(role) ? getHierarchyRoles(member).indexOf(role) + 1 : 5}`} key={`${role}-${index}`}>{role}</span>)}</span>
            {member.role === "Customer Rep" && member.mentorName && <span className="org-person-mentor">Mentor: <strong>{member.mentorName}</strong></span>}
          </span>
        </button>
        {canEdit && <div className="org-card-actions">
          <Button variant="ghost" size="icon" aria-label={`Edit ${member.name}`} title="Edit person" onClick={() => onEdit(member)}><Pencil size={15} /></Button>
          <Button variant="ghost" size="icon" aria-label={`Remove ${member.name}`} title="Remove person" onClick={() => onRemove(member)}><Trash2 size={15} /></Button>
        </div>}
      </article>
      {member.children.length > 0 && (
        <div className={`org-children ${member.children.length > 1 ? "org-children-many" : ""}`}>
          {member.children.map((child) => (
            <OrgBranch key={child.id} member={child} onEdit={onEdit} onRemove={onRemove} onOpenProfile={onOpenProfile} canEdit={canEdit} />
          ))}
        </div>
      )}
    </div>
  );
}
