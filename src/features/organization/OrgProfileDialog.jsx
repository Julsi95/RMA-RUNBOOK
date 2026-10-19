import { useEffect } from "react";
import { Cake, CalendarDays, Sparkles, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { getOrganizationRoleLabels } from "@/features/organization/organization-data";

function formatDate(value) {
  if (!value) return "Not added";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(date);
}

export default function OrgProfileDialog({ member, onClose }) {
  useEffect(() => {
    function closeOnEscape(event) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  if (!member) return null;
  const profile = member.profile ?? {};
  const customFields = Object.entries(profile.fields ?? {}).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");
  const initials = member.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";

  return <div className="org-profile-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="org-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="org-profile-title">
      <Button className="org-profile-close" type="button" variant="ghost" size="icon" aria-label="Close profile" onClick={onClose}><X size={18} /></Button>
      <header className="org-profile-header">
        <div className="org-profile-avatar">{member.photo ? <img src={member.photo} alt="" /> : <span>{initials}</span>}</div>
        <div className="org-profile-heading-copy">
          <p className="eyebrow">TEAM PROFILE</p>
          <h2 id="org-profile-title">{member.name}</h2>
          {member.role && <p>{member.role}</p>}
          <div className="org-profile-role-list">{getOrganizationRoleLabels(member).map((role) => <span className="org-role-chip" key={role}>{role}</span>)}</div>
        </div>
      </header>
      <div className="org-profile-body">
        <section className="org-profile-summary">
          <h3><UserRound size={15} /> About</h3>
          <p>{profile.summary?.trim() || "This person hasn’t added a profile summary yet."}</p>
        </section>
        <div className="org-profile-facts">
          <div className="org-profile-fact"><Cake size={16} /><span><small>Birthday</small><strong>{formatDate(profile.birthday)}</strong></span></div>
          <div className="org-profile-fact"><CalendarDays size={16} /><span><small>Joined the team</small><strong>{formatDate(profile.hireDate)}</strong></span></div>
          {profile.personality && <div className="org-profile-fact"><Sparkles size={16} /><span><small>Personality</small><strong>{profile.personality}</strong></span></div>}
        </div>
        {customFields.length > 0 && <section className="org-profile-custom-fields"><h3>More about {member.name.split(/\s+/)[0]}</h3><dl>{customFields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl></section>}
        {member.managerId && member.managerName && <p className="org-profile-manager">Reports to <strong>{member.managerName}</strong></p>}
      </div>
    </section>
  </div>;
}
