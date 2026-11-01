import { useEffect, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { getDescendantIds, getHierarchyRoles, getOrganizationRoleLabels, getReportingManagerIds, organizationHierarchyRoles, organizationRoles, organizationTeams } from "@/features/organization/organization-data";
import { Button } from "@/components/ui/Button";

function getInitials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

const restrictedReportingRoles = new Set(["Campaign Specialist", "Senior Agent"]);

function canSuperviseCampaignOrSenior(member) {
  const hierarchyRoles = getHierarchyRoles(member);
  return hierarchyRoles.includes("Team Lead (TL)") || hierarchyRoles.includes("Senior Team Lead (STL)");
}

function canManageRole(role, manager) {
  if (role === "Campaign Specialist") return canSuperviseCampaignOrSenior(manager);
  if (role === "Senior Agent") return canSuperviseCampaignOrSenior(manager) || manager?.role === "Campaign Specialist";
  if (role === "Customer Rep") return ["Campaign Specialist", "Senior Agent"].includes(manager?.role);
  return true;
}

function sameReportingLevel(members, ids) {
  if (ids.length < 2) return true;
  const parentSignatures = ids.map((id) => {
    const manager = members.find((person) => person.id === id);
    return getReportingManagerIds(manager).slice().sort().join("\u0000");
  });
  return new Set(parentSignatures).size === 1;
}

function resizePhoto(file) {
  return new Promise((resolve, reject) => {
    if (file.type === "image/gif") {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("That GIF could not be read. Try another image."));
      reader.readAsDataURL(file);
      return;
    }
    const image = new Image();
    const source = URL.createObjectURL(file);
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 480 / Math.max(image.width, image.height));
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(source);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => {
      URL.revokeObjectURL(source);
      reject(new Error("That image could not be opened. Try another file."));
    };
    image.src = source;
  });
}

export default function OrgMemberDialog({ member, members, onClose, onSave }) {
  const defaultRole = member?.role ?? "Customer Rep";
  const existingManagerIds = getReportingManagerIds(member);
  const existingManagerIsAllowed = existingManagerIds.length > 0
    && existingManagerIds.every((id) => canManageRole(defaultRole, members.find((person) => person.id === id)))
    && (existingManagerIds.length < 2 || sameReportingLevel(members, existingManagerIds));
  const defaultManagerId = existingManagerIds.length && existingManagerIsAllowed
    ? existingManagerIds[0]
    : defaultRole === "Senior Agent"
      ? members.find((person) => person.role === "Campaign Specialist")?.id ?? members.find(canSuperviseCampaignOrSenior)?.id ?? ""
      : defaultRole === "Customer Rep"
        ? members.find((person) => person.role === "Senior Agent")?.id ?? members.find((person) => person.role === "Campaign Specialist")?.id ?? ""
        : "";
  const [name, setName] = useState(member?.name ?? "");
  const [role, setRole] = useState(defaultRole);
  const [hierarchyRoles, setHierarchyRoles] = useState(() => getHierarchyRoles(member));
  const [reportingManagerIds, setReportingManagerIds] = useState(existingManagerIsAllowed ? existingManagerIds : defaultManagerId ? [defaultManagerId] : []);
  const [managerSearch, setManagerSearch] = useState("");
  const [team, setTeam] = useState(member?.team ?? "");
  const campaignSpecialists = members.filter((person) => person.role === "Campaign Specialist" && person.id !== member?.id);
  const [mentorId, setMentorId] = useState(member?.mentorId ?? "");
  const [photo, setPhoto] = useState(member?.photo ?? "");
  const [photoError, setPhotoError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const excludedManagerIds = member ? getDescendantIds(members, member.id) : new Set();
  const roleLevels = { "Operational Manager (OM)": 0, "Team Manager (TM)": 1, "Senior Team Lead (STL)": 2, "Team Lead (TL)": 3, "Team Lead": 3, "Campaign Specialist": 1, "Senior Agent": 2, "Customer Rep": 3 };
  const selectedRank = Math.min(...hierarchyRoles.map((item) => roleLevels[item] ?? 4), roleLevels[role] ?? 4);
  const managerOptions = members.filter((person) => person.id !== member?.id
    && !excludedManagerIds.has(person.id)
      && (restrictedReportingRoles.has(role) || role === "Customer Rep"
        ? canManageRole(role, person)
        : (existingManagerIds.includes(person.id) || Math.min(...getHierarchyRoles(person).map((item) => roleLevels[item] ?? 4), roleLevels[person.role] ?? 4) < selectedRank)));
  const sharedParentSignature = reportingManagerIds.length ? getReportingManagerIds(members.find((person) => person.id === reportingManagerIds[0])).slice().sort().join("\u0000") : null;
  const visibleManagerOptions = managerOptions.filter((person) => {
    if (!managerSearch.trim() && !sharedParentSignature) return true;
    if (sharedParentSignature && getReportingManagerIds(person).slice().sort().join("\u0000") !== sharedParentSignature) return false;
    const query = managerSearch.trim().toLowerCase();
    return !query || `${person.name} ${person.role}`.toLowerCase().includes(query);
  });

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function handlePhotoChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhotoError("");
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) { setPhotoError("Use a JPEG, PNG, WebP, or GIF image."); event.target.value = ""; return; }
    if (file.size > 5 * 1024 * 1024) { setPhotoError("Profile images must be 5 MB or smaller."); event.target.value = ""; return; }
    try {
      setPhoto(await resizePhoto(file));
    } catch (error) {
      setPhotoError(error.message);
    }
    event.target.value = "";
  }

  function handleRoleChange(event) {
    const nextRole = event.target.value;
    setRole(nextRole);
    const allowed = reportingManagerIds.filter((id) => canManageRole(nextRole, members.find((person) => person.id === id)));
    const fallback = nextRole === "Senior Agent"
      ? members.find((person) => person.role === "Campaign Specialist")?.id ?? members.find(canSuperviseCampaignOrSenior)?.id
      : nextRole === "Customer Rep"
        ? members.find((person) => person.role === "Senior Agent")?.id ?? members.find((person) => person.role === "Campaign Specialist")?.id
        : nextRole === "Campaign Specialist" ? members.find(canSuperviseCampaignOrSenior)?.id : null;
    setReportingManagerIds(allowed.length ? allowed : fallback ? [fallback] : []);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const cleanedName = name.trim();
    if (!cleanedName) return;
    if (["Campaign Specialist", "Senior Agent", "Customer Rep"].includes(role) && !reportingManagerIds.length) {
      setSaveError(role === "Senior Agent"
        ? "Choose a Team Lead, STL, or Campaign Specialist for this Senior Agent."
        : role === "Campaign Specialist" ? "Choose a Team Lead or Senior Team Lead (STL) for this Campaign Specialist." : "Choose a Campaign Specialist or Senior Agent for this Customer Rep.");
      return;
    }
    if (reportingManagerIds.some((id) => !managerOptions.some((person) => person.id === id))) {
      setSaveError("Choose active reporting managers allowed for this employee's role.");
      return;
    }
    if (reportingManagerIds.length > 1 && !sameReportingLevel(members, reportingManagerIds)) {
      setSaveError("Shared managers must be at the same reporting level so the chart can group them cleanly.");
      return;
    }
    if (reportingManagerIds.length > 1 && !["Customer Rep", "Senior Agent"].includes(role)) {
      setSaveError("Only Customer Reps and Senior Agents can have multiple reporting managers.");
      return;
    }
    if (role === "Senior Agent" && reportingManagerIds.length > 1 && reportingManagerIds.some((id) => members.find((person) => person.id === id)?.role !== "Campaign Specialist")) {
      setSaveError("A shared Senior Agent must report to Campaign Specialists.");
      return;
    }
    setSaving(true); setSaveError("");
    try {
      await onSave({
        ...(member?.id ? { id: member.id } : {}),
        name: cleanedName,
        role,
        team: team || null,
        hierarchyRoles,
        reportingManagerIds,
        managerId: reportingManagerIds[0] ?? null,
        coManagerId: reportingManagerIds[1] ?? null,
        mentorId: role === "Customer Rep" ? (mentorId || null) : null,
        photo,
        photoPath: member?.photoPath ?? "",
      });
    } catch (error) { setSaveError(error.message || "Could not save this employee."); }
    finally { setSaving(false); }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="member-dialog" role="dialog" aria-modal="true" aria-labelledby="member-dialog-title">
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">TEAM DIRECTORY</p>
            <h2 id="member-dialog-title">{member ? "Edit team member" : "Add employee"}</h2>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close dialog" onClick={onClose}><X size={18} /></Button>
        </div>

        <form className="member-form" onSubmit={handleSubmit}>
          <div className="photo-editor-row">
            <div className="member-avatar member-avatar-large">
              {photo ? <img src={photo} alt="" /> : <span>{getInitials(name)}</span>}
            </div>
            <div className="photo-editor-copy">
              <strong>Profile photo</strong>
              <span>Optional · JPG, PNG, or GIF</span>
              <label className="photo-upload-button">
                <ImagePlus size={15} />
                <span>{photo ? "Change photo" : "Upload photo"}</span>
                <input type="file" accept="image/*" onChange={handlePhotoChange} />
              </label>
              {photo && <button className="remove-photo-button" type="button" onClick={() => setPhoto("")}>Remove photo</button>}
              {photoError && <span className="form-error">{photoError}</span>}
            </div>
          </div>

          <label className="form-field">
            <span>Name</span>
            <input autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Enter full name" />
          </label>
          <label className="form-field"><span>Team</span><select value={team} onChange={(event) => setTeam(event.target.value)}><option value="">No team selected</option>{organizationTeams.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
          <label className="form-field">
            <span>Operational role <small>(optional for OM/TM)</small></span>
            <select value={role} onChange={handleRoleChange}>
              <option value="">No operational role</option>
              {organizationRoles.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <fieldset className="org-hierarchy-fieldset">
            <legend>Leadership hierarchy</legend>
            <p>These are the person’s organizational roles. OM/TM-only members can leave operational role blank; an STL can also hold TL.</p>
            <div className="org-hierarchy-options">
              {organizationHierarchyRoles.map((option, index) => <label className="org-hierarchy-option" key={option}>
                <input type="checkbox" checked={hierarchyRoles.includes(option)} onChange={(event) => setHierarchyRoles((current) => event.target.checked ? [...new Set([...current, option])] : current.filter((item) => item !== option))} />
                <span className="org-hierarchy-option-rank">0{index + 1}</span><span>{option}</span>
              </label>)}
            </div>
          </fieldset>
          <div className="form-field">
            <span>Reports to <small>{role === "Senior Agent" ? "(Team Lead, STL, or Campaign Specialist)" : role === "Campaign Specialist" ? "(Team Lead or STL)" : role === "Customer Rep" ? "(Campaign Specialist or Senior Agent)" : "(optional)"}</small></span>
            <input type="search" value={managerSearch} onChange={(event) => setManagerSearch(event.target.value)} placeholder="Search managers by name or role" />
            {reportingManagerIds.length > 0 && <div className="org-reporting-manager-selected" aria-label="Selected reporting managers">{reportingManagerIds.map((id) => {
              const person = members.find((item) => item.id === id);
              if (!person) return null;
              return <span key={id}>{person.role} · {person.name}<button type="button" aria-label={`Remove ${person.name} as manager`} onClick={() => setReportingManagerIds((current) => current.filter((value) => value !== id))}><X size={12} /></button></span>;
            })}</div>}
            <div className="org-reporting-manager-list" role="group" aria-label="Reporting managers">
              {visibleManagerOptions.map((person) => {
                const selected = reportingManagerIds.includes(person.id);
                return <label className={selected ? "selected" : ""} key={person.id}>
                  <input type="checkbox" checked={selected} onChange={(event) => setReportingManagerIds((current) => event.target.checked
                    ? (["Customer Rep", "Senior Agent"].includes(role) ? [...current, person.id] : [person.id])
                    : current.filter((id) => id !== person.id))} />
                  <span><strong>{getOrganizationRoleLabels(person).join(" / ")}</strong><small>{person.name}</small></span>
                </label>;
              })}
              {visibleManagerOptions.length === 0 && <p className="form-field-hint">{managerOptions.length === 0 ? "No eligible active managers are available for this role." : "No managers match your search or the selected reporting level."}</p>}
            </div>
            <small className="form-field-hint">Select one manager for an individual reporting line, or select several peers to share responsibility. Newly added reports appear after existing people in the group.</small>
          </div>
          {role === "Customer Rep" && <label className="form-field">
              <span>Mentor <small>(optional)</small></span>
              <select value={mentorId} onChange={(event) => setMentorId(event.target.value)}>
                <option value="">No mentor selected</option>
                {campaignSpecialists.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>}
          {saveError && <p className="form-error" role="alert">{saveError}</p>}
          <div className="dialog-actions">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || ([...restrictedReportingRoles, "Customer Rep"].includes(role) && managerOptions.length === 0)}>{saving ? "Saving…" : member ? "Save changes" : "Add employee"}</Button>
          </div>
        </form>
      </section>
    </div>
  );
}
