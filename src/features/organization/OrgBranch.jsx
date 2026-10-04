import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

function getInitials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

export default function OrgBranch({ member, onEdit, onRemove }) {
  return (
    <div className="org-branch">
      <article className="org-person-card">
        <div className="member-avatar">
          {member.photo ? <img src={member.photo} alt={`${member.name}`} /> : <span>{getInitials(member.name)}</span>}
        </div>
        <div className="org-person-details">
          <h3 title={member.name}>{member.name}</h3>
          <span className="org-person-role">{member.role}</span>
          {member.role === "Customer Rep" && member.mentorName && <small className="org-person-mentor">Mentor: <strong>{member.mentorName}</strong></small>}
        </div>
        <div className="org-card-actions">
          <Button variant="ghost" size="icon" aria-label={`Edit ${member.name}`} title="Edit person" onClick={() => onEdit(member)}><Pencil size={15} /></Button>
          <Button variant="ghost" size="icon" aria-label={`Remove ${member.name}`} title="Remove person" onClick={() => onRemove(member)}><Trash2 size={15} /></Button>
        </div>
      </article>
      {member.children.length > 0 && (
        <div className={`org-children ${member.children.length > 1 ? "org-children-many" : ""}`}>
          {member.children.map((child) => (
            <OrgBranch key={child.id} member={child} onEdit={onEdit} onRemove={onRemove} />
          ))}
        </div>
      )}
    </div>
  );
}
