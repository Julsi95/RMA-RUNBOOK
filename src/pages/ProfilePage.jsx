import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BriefcaseBusiness, CalendarDays, Clock3, Mail, MapPin, ShieldCheck, Sparkles, UserRound, UsersRound } from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "@/app/auth-provider";
import { useOrganizationRoster } from "@/app/organization-provider";
import { isOrganizationOnlyLeader } from "@/features/organization/organization-data";
import { signedOwnProfilePhoto } from "@/lib/backend-repositories";

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(date);
}

function teamTenure(value) {
  if (!value) return "Not set";
  const start = new Date(`${value}T00:00:00`);
  if (Number.isNaN(start.getTime()) || start > new Date()) return "Not set";
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 12) return `${Math.max(0, months)} ${months === 1 ? "month" : "months"}`;
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  return `${years} ${years === 1 ? "year" : "years"}${remainder ? `, ${remainder} ${remainder === 1 ? "month" : "months"}` : ""}`;
}

function InfoItem({ icon: Icon, label, value }) {
  return <div className="profile-info-item"><span className="profile-info-icon"><Icon size={16} /></span><span className="profile-info-copy"><small>{label}</small><strong>{value || "Not set"}</strong></span></div>;
}

export default function ProfilePage() {
  const { user, account, accountProfile } = useAuth();
  const { members, profiles, customFieldDefinitions, loading, error } = useOrganizationRoster();
  const [photoUrl, setPhotoUrl] = useState("");
  const member = useMemo(() => members.find((item) => item.id === account?.employee_id) ?? null, [members, account?.employee_id]);
  const employeeProfile = member ? profiles[member.id] ?? member.profile ?? {} : {};
  const name = account?.display_name || member?.name || user?.email?.split("@")[0] || "RUNBOOK member";
  const role = account?.role === "super_admin" ? "Super Admin" : account?.role === "admin" || account?.can_edit ? "Admin" : "Member";
  const teamRole = isOrganizationOnlyLeader(member) ? "RUNBOOK member" : member?.role || "Not linked";
  const summary = accountProfile?.summary || employeeProfile.summary || "Add a short introduction in account settings to help your team get to know you.";
  const profilePhoto = photoUrl || member?.photo || "";
  const customValues = employeeProfile.fields ?? {};
  const customItems = customFieldDefinitions
    .map((definition) => ({ label: definition.label, value: customValues[definition.id] ?? customValues[definition.label] }))
    .filter((item) => item.value !== undefined && item.value !== null && String(item.value).trim());

  useEffect(() => {
    let active = true;
    setPhotoUrl("");
    if (!accountProfile?.photo_path) return () => { active = false; };
    void signedOwnProfilePhoto(accountProfile.photo_path).then((url) => { if (active) setPhotoUrl(url); }).catch(() => {});
    return () => { active = false; };
  }, [accountProfile?.photo_path]);

  return <section className="page-content profile-page">
    <div className="page-heading"><div><p className="eyebrow">YOUR RUNBOOK IDENTITY</p><h1>My profile</h1><p className="page-description">Your account and team details in one place.</p></div><Link className="profile-edit-button" to="/settings"><UserRound size={16} /> Edit account</Link></div>

    <section className="profile-hero">
      <div className="profile-hero-glow" aria-hidden="true" />
      <div className="profile-hero-main">
        <div className="profile-avatar-large">{profilePhoto ? <img src={profilePhoto} alt={`${name}'s profile`} /> : <span>{name.slice(0, 1).toUpperCase()}</span>}</div>
        <div className="profile-hero-copy"><span className="profile-role-chip"><ShieldCheck size={13} /> {role}</span><h2>{name}</h2><p>{member?.role || "RUNBOOK account"}{member?.name && account?.employee_id ? ` · ${member.name}` : ""}</p></div>
      </div>
      <div className="profile-hero-summary"><Sparkles size={16} /><p>{summary}</p></div>
    </section>

    <div className="profile-detail-grid">
      <section className="profile-panel">
        <div className="profile-panel-heading"><span className="profile-panel-icon"><UserRound size={17} /></span><div><h2>Account details</h2><p>Information connected to your sign-in.</p></div></div>
        <div className="profile-info-list">
          <InfoItem icon={Mail} label="Login email" value={user?.email} />
          <InfoItem icon={ShieldCheck} label="Access level" value={role} />
          <InfoItem icon={UsersRound} label="Linked employee" value={member?.name || "No employee record linked"} />
          <InfoItem icon={BriefcaseBusiness} label="Team role" value={teamRole} />
        </div>
      </section>

      <section className="profile-panel">
        <div className="profile-panel-heading"><span className="profile-panel-icon"><BriefcaseBusiness size={17} /></span><div><h2>Team profile</h2><p>Details from your Agent Profile.</p></div></div>
        {loading ? <p className="profile-panel-state" role="status">Loading team details…</p> : error ? <p className="profile-panel-state">Team details could not be loaded right now.</p> : !member ? <div className="profile-panel-state"><strong>No employee record is linked to this account yet.</strong><span>An administrator can link your account to your employee profile from Settings.</span></div> : <div className="profile-info-list">
          <InfoItem icon={CalendarDays} label="Birthday" value={formatDate(employeeProfile.birthday)} />
          <InfoItem icon={CalendarDays} label="Joined the team" value={formatDate(employeeProfile.hireDate)} />
          <InfoItem icon={Clock3} label="Time on team" value={teamTenure(employeeProfile.hireDate)} />
          <InfoItem icon={Sparkles} label="Personality type" value={employeeProfile.personality} />
          {customItems.map((item) => <InfoItem key={item.label} icon={MapPin} label={item.label} value={String(item.value)} />)}
        </div>}
        {member && <p className="profile-privacy-note">Some team fields may be hidden based on profile visibility settings.</p>}
      </section>
    </div>

    <Link className="profile-footer-link" to="/agent-profiles"><span><strong>Meet the team</strong><small>Browse the full Agent Profiles directory.</small></span><ArrowRight size={17} /></Link>
  </section>;
}
