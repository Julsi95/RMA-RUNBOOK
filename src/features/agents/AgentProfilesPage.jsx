import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Cake, CalendarDays, Check, ChevronRight, CircleUserRound, Eye, FilePlus2, Pencil, Plus, Search, Settings2, Sparkles, Trash2, UsersRound, X } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { useOrganizationRoster } from "@/app/organization-provider";
import { useAuth } from "@/app/auth-provider";
import "@/features/agents/agent-profiles.css";

const PROFILES_KEY = "starter-app-agent-profiles-v1";
const FIELDS_KEY = "starter-app-agent-profile-fields-v1";
const PERSONALITIES = [
  { code: "INTJ", name: "Architect", family: "Analyst" }, { code: "INTP", name: "Logician", family: "Analyst" },
  { code: "ENTJ", name: "Commander", family: "Analyst" }, { code: "ENTP", name: "Debater", family: "Analyst" },
  { code: "INFJ", name: "Advocate", family: "Diplomat" }, { code: "INFP", name: "Mediator", family: "Diplomat" },
  { code: "ENFJ", name: "Protagonist", family: "Diplomat" }, { code: "ENFP", name: "Campaigner", family: "Diplomat" },
  { code: "ISTJ", name: "Logistician", family: "Sentinel" }, { code: "ISFJ", name: "Defender", family: "Sentinel" },
  { code: "ESTJ", name: "Executive", family: "Sentinel" }, { code: "ESFJ", name: "Consul", family: "Sentinel" },
  { code: "ISTP", name: "Virtuoso", family: "Explorer" }, { code: "ISFP", name: "Adventurer", family: "Explorer" },
  { code: "ESTP", name: "Entrepreneur", family: "Explorer" }, { code: "ESFP", name: "Entertainer", family: "Explorer" },
];
const PERSONALITY_OPTIONS = PERSONALITIES.flatMap((type) => ["A", "T"].map((variant) => ({ ...type, variant, value: type.code + "-" + variant })));
const FIELD_TYPES = [
  { value: "text", label: "Short text" }, { value: "longText", label: "Long text" },
  { value: "date", label: "Date" }, { value: "number", label: "Number" }, { value: "url", label: "Link" },
];

function readObject(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function readFields() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FIELDS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? "profile-field-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "?";
}

function dateOnly(value) {
  return value ? new Date(value + "T12:00:00") : null;
}

function localDateValue(date = new Date()) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function birthdayDate(value, now = new Date()) {
  if (!value) return null;
  const [, month, day] = value.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? [];
  if (!month || !day) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), Number(month) - 1, Number(day));
  if (next < today) next = new Date(now.getFullYear() + 1, Number(month) - 1, Number(day));
  return { date: next, days: Math.round((next - today) / 86400000) };
}

function birthdayInYear(value, year) {
  if (!value) return null;
  const [, month, day] = value.match(/^\d{4}-(\d{2})-(\d{2})$/) ?? [];
  if (!month || !day) return null;
  const date = new Date(year, Number(month) - 1, Number(day));
  if (date.getFullYear() !== year) return null;
  return { date, month: Number(month) };
}

function birthdayLabel(value, options = { month: "short", day: "numeric" }) {
  const date = dateOnly(value);
  return date ? new Intl.DateTimeFormat("en-US", options).format(date) : "Add birthday";
}

function birthdayMessage(days) {
  if (days === 0) return "Today!";
  if (days === 1) return "Tomorrow";
  if (days < 7) return "In " + days + " days";
  if (days < 30) return "In " + days + " days";
  const months = Math.floor(days / 30);
  return "In " + months + (months === 1 ? " month" : " months");
}

function birthdayAgoMessage(days) {
  if (days === 1) return "Yesterday";
  return days + " days ago";
}

function tenureLabel(hireDate, now = new Date()) {
  const start = dateOnly(hireDate);
  if (!start) return "";
  start.setHours(0, 0, 0, 0);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (start > today) return "";
  let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  if (now.getDate() < start.getDate()) months -= 1;
  months = Math.max(0, months);
  const years = Math.floor(months / 12);
  const remaining = months % 12;
  if (years === 0 && remaining === 0) return "Less than a month";
  return [years ? years + (years === 1 ? " year" : " years") : "", remaining ? remaining + (remaining === 1 ? " month" : " months") : ""].filter(Boolean).join(" · ");
}

function personalityInfo(value) {
  const found = PERSONALITY_OPTIONS.find((item) => item.value === value);
  return found ?? null;
}

function PersonAvatar({ member, large = false }) {
  return <span className={"agent-profile-avatar" + (large ? " is-large" : "")}>{member.photo ? <img src={member.photo} alt="" /> : initials(member.name)}</span>;
}

export default function AgentProfilesPage() {
  const { members, profiles: sharedProfiles, customFieldDefinitions, loading: rosterLoading, error: rosterError, saveEmployeeProfile, saveFieldDefinitions } = useOrganizationRoster();
  const { canEdit, configured } = useAuth();
  const canManage = canEdit && !rosterLoading && !rosterError;
  const [localProfiles, setLocalProfiles] = useState(() => configured ? {} : readObject(PROFILES_KEY));
  const [localCustomFields, setLocalCustomFields] = useState(() => configured ? [] : readFields());
  const profiles = configured ? sharedProfiles : localProfiles;
  const customFields = configured ? customFieldDefinitions.map((field) => ({ id: field.id, label: field.label, type: field.field_type ?? field.type })) : localCustomFields;
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("All roles");
  const [birthdayMonth, setBirthdayMonth] = useState("all");
  const [birthdayView, setBirthdayView] = useState("upcoming");
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [draft, setDraft] = useState(null);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const visibilityControlRef = useRef(null);
  const [fieldDrafts, setFieldDrafts] = useState([]);
  const [profileError, setProfileError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  useEffect(() => {
    if (!visibilityOpen) return undefined;
    function closeOutside(event) {
      if (!visibilityControlRef.current?.contains(event.target)) setVisibilityOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [visibilityOpen]);
  const today = new Date();
  const roles = useMemo(() => [...new Set(members.map((member) => member.role).filter(Boolean))].sort(), [members]);
  const birthdaysThisYear = useMemo(() => members.map((member) => {
    const birthday = birthdayInYear(profiles[member.id]?.birthday, today.getFullYear());
    return birthday ? { member, ...birthday } : null;
  }).filter(Boolean), [members, profiles, today.getFullYear()]);
  const upcomingBirthdaysThisYear = birthdaysThisYear.filter((item) => item.date >= new Date(today.getFullYear(), today.getMonth(), today.getDate())).sort((a, b) => a.date - b.date);
  const recentlyPassedBirthdays = birthdaysThisYear.filter((item) => {
    const daysAgo = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - item.date) / 86400000);
    return daysAgo > 0 && daysAgo <= 30;
  }).map((item) => ({ ...item, daysAgo: Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - item.date) / 86400000) })).sort((a, b) => b.date - a.date);
  const birthdayCollection = birthdayView === "upcoming" ? upcomingBirthdaysThisYear : recentlyPassedBirthdays;
  const birthdayMonths = birthdayView === "upcoming"
    ? Array.from({ length: 12 - today.getMonth() }, (_, index) => today.getMonth() + index + 1)
    : Array.from({ length: today.getMonth() + 1 }, (_, index) => index + 1);
  const visibleBirthdays = birthdayMonth === "all" ? birthdayCollection : birthdayCollection.filter((item) => item.month === Number(birthdayMonth));
  const completedCount = members.filter((member) => {
    const profile = profiles[member.id] ?? {};
    return Boolean(profile.birthday || profile.hireDate || profile.personality);
  }).length;
  const visibleMembers = members.filter((member) => {
    const profile = profiles[member.id] ?? {};
    const text = [member.name, member.role, profile.personality, personalityInfo(profile.personality)?.name, profile.summary].filter(Boolean).join(" ").toLowerCase();
    return (roleFilter === "All roles" || member.role === roleFilter) && text.includes(query.trim().toLowerCase());
  });

  useEffect(() => {
    if (!configured) return;
    setLocalProfiles({});
    setLocalCustomFields([]);
  }, [configured]);

  function persistLocalProfiles(next) {
    setLocalProfiles(next);
    try { localStorage.setItem(PROFILES_KEY, JSON.stringify(next)); } catch { /* keep edits for this session */ }
  }

  async function deleteBirthday(memberId) {
    if (!canManage) return;
    const next = { ...(profiles[memberId] ?? {}), birthday: "" };
    if (configured) {
      try { await saveEmployeeProfile(memberId, next); setProfileError(""); }
      catch (error) { setProfileError(error.message || "Could not update this profile."); }
    } else persistLocalProfiles({ ...profiles, [memberId]: next });
  }

  function editPerson(member) {
    const profile = profiles[member.id] ?? { birthday: "", hireDate: "", personality: "", summary: "", fields: {}, visibility: {} };
    setSelectedPerson(member);
    setDraft({ ...profile, fields: { ...(profile.fields ?? {}) }, visibility: { photo: true, ...(profile.visibility ?? {}) } });
    setProfileError("");
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!canManage) return;
    const next = { ...profiles, [selectedPerson.id]: { ...draft, summary: draft.summary.trim() } };
    setSavingProfile(true); setProfileError("");
    try {
      if (configured) await saveEmployeeProfile(selectedPerson.id, next[selectedPerson.id]);
      else persistLocalProfiles(next);
      setSelectedPerson(null); setDraft(null);
    } catch (error) { setProfileError(error.message || "Could not save this profile."); }
    finally { setSavingProfile(false); }
  }

  function openFields() {
    if (!canManage) return;
    setFieldDrafts(customFields.map((field) => ({ ...field, type: field.type ?? field.field_type })));
    setFieldsOpen(true);
  }

  async function saveFields() {
    if (!canManage) return;
    const cleaned = fieldDrafts.map((field) => ({ ...field, label: field.label.trim() })).filter((field) => field.label);
    const keep = new Set(cleaned.map((field) => field.id));
    const nextProfiles = Object.fromEntries(Object.entries(profiles).map(([memberId, profile]) => [memberId, { ...profile, fields: Object.fromEntries(Object.entries(profile.fields ?? {}).filter(([id]) => keep.has(id))) }]));
    try {
      if (configured) {
        await saveFieldDefinitions(cleaned);
        await Promise.all(Object.entries(nextProfiles).filter(([id, profile]) => JSON.stringify(profile.fields) !== JSON.stringify(profiles[id]?.fields ?? {})).map(([id, profile]) => saveEmployeeProfile(id, profile)));
      } else {
        setLocalCustomFields(cleaned);
        try { localStorage.setItem(FIELDS_KEY, JSON.stringify(cleaned)); } catch { /* current session remains available */ }
        persistLocalProfiles(nextProfiles);
      }
      setFieldsOpen(false); setProfileError("");
    } catch (error) { setProfileError(error.message || "Could not save profile fields."); }
  }

  function addField() {
    setFieldDrafts((current) => [...current, { id: newId(), label: "", type: "text" }]);
  }

  return <section className="page-content agent-profiles-page">
    <header className="page-heading agent-profiles-heading">
      <div><p className="eyebrow">PEOPLE · TEAM DIRECTORY</p><h1>Agent profiles</h1><p className="page-description">Get to know your team, celebrate milestones, and keep useful profile details together.</p></div>
      <div className="agent-profile-heading-actions">{canManage && <Button type="button" variant="outline" onClick={openFields}><Settings2 size={16} /> Profile fields</Button>}<Link to="/organizational" className="agent-manage-roster-link"><UsersRound size={15} /> Manage roster <ArrowRight size={14} /></Link></div>
    </header>
    {(profileError || rosterError) && <p className="auth-error" role="alert">{profileError || rosterError}</p>}

    <section className="agent-directory-overview">
      <div className="agent-directory-copy"><span className="agent-directory-icon"><Sparkles size={19} /></span><div><span className="agent-directory-kicker">TEAM SNAPSHOT</span><strong>A little more about the people behind the work.</strong><small>Photos, names, and roles stay in sync with your organization chart.</small></div></div>
      <div className="agent-overview-stats"><div><strong>{members.length}</strong><span>team members</span></div><i /><div><strong>{members.filter((member) => profiles[member.id]?.birthday).length}</strong><span>birthdays saved</span></div><i /><div><strong>{completedCount}</strong><span>profiles started</span></div></div>
    </section>

    <section className="agent-birthday-panel">
      <div className="agent-birthday-calendar-heading"><div className="agent-birthday-title"><span className="agent-birthday-icon"><Cake size={17} /></span><div><p className="agent-profile-kicker">CURRENT YEAR · {today.getFullYear()}</p><h2>Birthday calendar</h2></div></div><span className="agent-birthday-count">{birthdayView === "upcoming" ? upcomingBirthdaysThisYear.length + " upcoming" : recentlyPassedBirthdays.length + " past 30 days"}</span></div>
      <div className="agent-birthday-views" role="group" aria-label="Birthday calendar view"><button type="button" className={birthdayView === "upcoming" ? "active" : ""} aria-pressed={birthdayView === "upcoming"} onClick={() => { setBirthdayView("upcoming"); setBirthdayMonth("all"); }}>Upcoming <span>{upcomingBirthdaysThisYear.length}</span></button><button type="button" className={birthdayView === "recent" ? "active" : ""} aria-pressed={birthdayView === "recent"} onClick={() => { setBirthdayView("recent"); setBirthdayMonth("all"); }}>Recently passed <span>{recentlyPassedBirthdays.length}</span></button></div>
      <div className="agent-birthday-months" role="group" aria-label="Filter birthdays by month"><button type="button" className={birthdayMonth === "all" ? "active" : ""} aria-pressed={birthdayMonth === "all"} onClick={() => setBirthdayMonth("all")}>{birthdayView === "upcoming" ? "All upcoming" : "All recent"}</button>{birthdayMonths.map((month) => <button type="button" className={birthdayMonth === String(month) ? "active" : ""} aria-pressed={birthdayMonth === String(month)} key={month} onClick={() => setBirthdayMonth(String(month))}>{new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(today.getFullYear(), month - 1, 1))}<span>{birthdayCollection.filter((item) => item.month === month).length}</span></button>)}</div>
      {visibleBirthdays.length ? <div className="agent-birthday-list">{visibleBirthdays.map(({ member, date, daysAgo }) => {
        const days = Math.round((date - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
        return <div className="agent-birthday-item" key={member.id}><button type="button" className="agent-birthday-open" onClick={() => editPerson(member)}><PersonAvatar member={member} /><span><strong>{member.name}</strong><small>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date)} · {birthdayView === "upcoming" ? birthdayMessage(days) : birthdayAgoMessage(daysAgo)}</small></span><ChevronRight size={15} /></button>{canManage && <Button type="button" variant="ghost" size="icon" className="agent-birthday-delete" aria-label={"Remove birthday for " + member.name} title="Remove birthday" onClick={() => void deleteBirthday(member.id)}><Trash2 size={14} /></Button>}</div>;
      })}</div> : <button className="agent-birthday-empty" type="button" onClick={() => members[0] && editPerson(members[0])}><span>{birthdayView === "upcoming" ? (upcomingBirthdaysThisYear.length ? "No upcoming birthdays in this month" : "No birthdays remaining this year") : (recentlyPassedBirthdays.length ? "No recent birthdays in this month" : "No birthdays in the past 30 days")}</span><span>Add or edit a profile <ArrowRight size={14} /></span></button>}
    </section>

    <section className="agent-directory">
      <div className="agent-directory-toolbar"><div><p className="agent-profile-kicker">THE CREW</p><h2>Meet the team</h2></div><div className="agent-directory-controls"><label className="agent-profile-search"><Search size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people or personality" aria-label="Search agent profiles" /></label><Select value={roleFilter} onValueChange={setRoleFilter}><SelectTrigger aria-label="Filter profiles by role"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All roles">All roles</SelectItem>{roles.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}</SelectContent></Select></div></div>
      {visibleMembers.length ? <div className="agent-profile-grid">{visibleMembers.map((member, index) => {
        const profile = profiles[member.id] ?? {};
        const personality = personalityInfo(profile.personality);
        const nextBirthday = birthdayDate(profile.birthday, today);
        const tenure = tenureLabel(profile.hireDate, today);
        return <button type="button" className={"agent-profile-card agent-profile-card-" + (index % 4)} key={member.id} onClick={() => editPerson(member)} aria-label={"View " + member.name + " profile"}>
          <span className="agent-card-accent" />
          <span className="agent-profile-card-top"><span className="agent-card-role">{member.role || "Team member"}</span><span className="agent-card-arrow"><ArrowRight size={15} /></span></span>
          <span className="agent-card-person"><PersonAvatar member={member} large /><span><strong>{member.name}</strong><small>{personality ? personality.name + " · " + profile.personality : "Personality not added"}</small></span></span>
          {profile.summary && <span className="agent-card-summary">{profile.summary}</span>}
          <span className="agent-card-details"><span><Cake size={14} /><span>{profile.birthday ? birthdayLabel(profile.birthday) + (nextBirthday ? " · " + birthdayMessage(nextBirthday.days) : "") : "Birthday not set"}</span></span><span><CalendarDays size={14} /><span>{tenure ? tenure + " here" : profile.hireDate ? "Hire date in the future" : "Hire date not set"}</span></span></span>
          <span className="agent-card-bottom"><span>{customFields.length ? Object.values(profile.fields ?? {}).filter(Boolean).length + " profile details" : "Open full profile"}</span><ChevronRight size={15} /></span>
        </button>;
      })}</div> : <div className="agent-profile-empty"><CircleUserRound size={22} /><strong>{members.length ? "No profiles match" : "Add people to your organization first"}</strong><span>{members.length ? "Try a different name or role." : "Your profile directory uses the shared employee roster."}</span>{!members.length && <Link to="/organizational">Open organization chart <ArrowRight size={14} /></Link>}</div>}
    </section>

    {selectedPerson && draft && <div className="agent-profile-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSelectedPerson(null); setDraft(null); } }}><form className="agent-profile-drawer" role="dialog" aria-modal="true" aria-labelledby="agent-profile-dialog-title" onSubmit={saveProfile}>
      <div className="agent-profile-drawer-top"><div><span className="agent-profile-kicker">TEAM PROFILE</span><Button type="button" variant="ghost" size="icon" aria-label="Close profile" onClick={() => { setSelectedPerson(null); setDraft(null); }}><X size={18} /></Button></div>
        <div className="agent-profile-cover"><span className="agent-cover-orbit agent-cover-orbit-one" /><span className="agent-cover-orbit agent-cover-orbit-two" /><PersonAvatar member={selectedPerson} large /></div>
        <div className="agent-profile-identity"><div><h2 id="agent-profile-dialog-title">{selectedPerson.name}</h2><span>{selectedPerson.role || "Team member"}</span></div><span className="agent-roster-sync"><Check size={13} /> Organization roster</span></div>
      </div>
      <div className="agent-profile-form-scroll">
      <div className="agent-profile-date-grid"><label className="agent-profile-field"><span><Cake size={14} /> Birthday</span><input type="date" disabled={!canManage} value={draft.birthday ?? ""} max={localDateValue()} onChange={(event) => setDraft((value) => ({ ...value, birthday: event.target.value }))} /></label><label className="agent-profile-field"><span><CalendarDays size={14} /> Joined the team</span><input type="date" disabled={!canManage} value={draft.hireDate ?? ""} max={localDateValue()} onChange={(event) => setDraft((value) => ({ ...value, hireDate: event.target.value }))} /></label></div>
        {canManage && <div className="agent-visibility-control" ref={visibilityControlRef}><Button type="button" variant="outline" onClick={() => setVisibilityOpen((open) => !open)} aria-expanded={visibilityOpen}><Eye size={15} /> Profile visibility</Button>{visibilityOpen && <section className="agent-visibility-panel"><strong>Shown to signed-in users</strong><p>Hidden details are omitted from data reads.</p>{[["photo", "Profile photo"], ["birthday", "Birthday"], ["hireDate", "Hire date"], ["personality", "Personality"], ["summary", "Summary"]].map(([key, label]) => <label key={key}><input type="checkbox" checked={draft.visibility?.[key] ?? key === "photo"} onChange={(event) => setDraft((value) => ({ ...value, visibility: { ...value.visibility, [key]: event.target.checked } }))} /><span>{label}</span></label>)}{customFields.length > 0 && <div className="agent-visibility-custom"><span>Custom fields</span>{customFields.map((field) => <label key={field.id}><input type="checkbox" checked={Boolean(draft.visibility?.fields?.[field.id])} onChange={(event) => setDraft((value) => ({ ...value, visibility: { ...value.visibility, fields: { ...value.visibility?.fields, [field.id]: event.target.checked } } }))} /><span>{field.label}</span></label>)}</div>}</section>}</div>}
        {draft.hireDate && <div className="agent-tenure-display"><CalendarDays size={15} /><span>On the team for</span><strong>{tenureLabel(draft.hireDate, today) || "Less than a month"}</strong></div>}
        <section className="agent-profile-personality"><div className="agent-profile-section-heading"><span><Sparkles size={15} /> Personality</span><small>{canManage ? "Editable snapshot" : "Team profile"}</small></div><label className="agent-profile-field"><span>16 personalities type</span><Select disabled={!canManage} value={draft.personality || "none"} onValueChange={(personality) => setDraft((value) => ({ ...value, personality: personality === "none" ? "" : personality }))}><SelectTrigger aria-label="Select personality type" disabled={!canManage}><SelectValue placeholder="Choose a personality type" /></SelectTrigger><SelectContent><SelectItem value="none">Not set</SelectItem>{PERSONALITY_OPTIONS.map((item) => <SelectItem value={item.value} key={item.value}>{item.name} · {item.value} · {item.family}</SelectItem>)}</SelectContent></Select></label>
          {draft.personality && <div className="agent-personality-badge"><span>{personalityInfo(draft.personality)?.name}</span><strong>{draft.personality}</strong><small>{personalityInfo(draft.personality)?.family}</small></div>}
          <label className="agent-profile-field"><span>Short personality summary</span><textarea rows="3" readOnly={!canManage} value={draft.summary ?? ""} onChange={(event) => setDraft((value) => ({ ...value, summary: event.target.value }))} placeholder="Add a few words about their style or strengths" /></label>
        </section>
        {customFields.length > 0 && <section className="agent-custom-profile-fields"><div className="agent-profile-section-heading"><span><FilePlus2 size={15} /> Extra details</span><small>Shared fields</small></div>{customFields.map((field) => <label className="agent-profile-field" key={field.id}><span>{field.label}</span>{field.type === "longText" ? <textarea rows="3" readOnly={!canManage} value={draft.fields?.[field.id] ?? ""} onChange={(event) => setDraft((value) => ({ ...value, fields: { ...value.fields, [field.id]: event.target.value } }))} /> : <input readOnly={!canManage} type={field.type === "url" ? "url" : field.type === "number" || field.type === "date" ? field.type : "text"} value={draft.fields?.[field.id] ?? ""} onChange={(event) => setDraft((value) => ({ ...value, fields: { ...value.fields, [field.id]: event.target.value } }))} />}</label>)}</section>}
        <div className="agent-profile-sync-note">Name, role, and photo are managed from the <Link to="/organizational" onClick={() => { setSelectedPerson(null); setDraft(null); }}>Organization page</Link>.</div>
      </div>
      {profileError && <p className="auth-error" role="alert">{profileError}</p>}
      <div className="agent-profile-drawer-actions"><Button type="button" variant="outline" onClick={() => { setSelectedPerson(null); setDraft(null); }}>{canManage ? "Cancel" : "Close"}</Button>{canManage && <Button type="submit" disabled={savingProfile}><Check size={15} /> {savingProfile ? "Saving…" : "Save profile"}</Button>}</div>
    </form></div>}

    {fieldsOpen && <div className="agent-fields-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setFieldsOpen(false); }}><section className="agent-fields-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-fields-title">
      <div className="agent-fields-heading"><div><span className="agent-profile-kicker">DIRECTORY SETTINGS</span><h2 id="agent-fields-title">Profile fields</h2><p>These details are available on every team profile.</p></div><Button type="button" variant="ghost" size="icon" aria-label="Close profile fields" onClick={() => setFieldsOpen(false)}><X size={18} /></Button></div>
      <div className="agent-fields-list">{fieldDrafts.map((field) => <div className="agent-field-row" key={field.id}><label className="agent-profile-field"><span>Field name</span><input value={field.label} onChange={(event) => setFieldDrafts((current) => current.map((item) => item.id === field.id ? { ...item, label: event.target.value } : item))} placeholder="e.g. Favorite shift" /></label><label className="agent-profile-field"><span>Type</span><Select value={field.type} onValueChange={(type) => setFieldDrafts((current) => current.map((item) => item.id === field.id ? { ...item, type } : item))}><SelectTrigger aria-label={"Field type for " + (field.label || "new field")}><SelectValue /></SelectTrigger><SelectContent>{FIELD_TYPES.map((type) => <SelectItem value={type.value} key={type.value}>{type.label}</SelectItem>)}</SelectContent></Select></label><Button type="button" variant="ghost" size="icon" className="agent-field-delete" aria-label={"Remove field " + (field.label || "new field")} onClick={() => setFieldDrafts((current) => current.filter((item) => item.id !== field.id))}><Trash2 size={15} /></Button></div>)}
        {!fieldDrafts.length && <div className="agent-fields-empty">No custom fields yet. Add fields for details you want to track across the team.</div>}
      </div>
      <Button type="button" variant="outline" className="agent-add-field-button" onClick={addField}><Plus size={15} /> Add shared field</Button>
      <div className="agent-fields-actions"><Button type="button" variant="outline" onClick={() => setFieldsOpen(false)}>Cancel</Button><Button type="button" onClick={saveFields}><Check size={15} /> Save fields</Button></div>
    </section></div>}
  </section>;
}
