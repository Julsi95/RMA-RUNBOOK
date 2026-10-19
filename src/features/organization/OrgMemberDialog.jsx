import { useEffect, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { getDescendantIds, getHierarchyRoles, getOrganizationRoleLabels, organizationHierarchyRoles, organizationRoles } from "@/features/organization/organization-data";
import { Button } from "@/components/ui/Button";

function getInitials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

const restrictedReportingRoles = new Set(["Campaign Specialist", "Senior Agent"]);

function canSuperviseCampaignOrSenior(member) {
  const hierarchyRoles = getHierarchyRoles(member);
  return hierarchyRoles.includes("Team Lead (TL)") || hierarchyRoles.includes("Senior Team Lead (STL)");
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
  const currentManager = members.find((person) => person.id === member?.managerId);
  const existingManagerIsAllowed = !restrictedReportingRoles.has(defaultRole) || canSuperviseCampaignOrSenior(currentManager);
  const defaultManagerId = member?.managerId && existingManagerIsAllowed
    ? member.managerId
    : defaultRole === "Customer Rep"
      ? members.find((person) => person.role === "Senior Agent")?.id ?? ""
      : "";
  const [name, setName] = useState(member?.name ?? "");
  const [role, setRole] = useState(defaultRole);
  const [hierarchyRoles, setHierarchyRoles] = useState(() => getHierarchyRoles(member));
  const [managerId, setManagerId] = useState(defaultManagerId);
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
    && (restrictedReportingRoles.has(role)
      ? canSuperviseCampaignOrSenior(person)
      : (person.id === member?.managerId || Math.min(...getHierarchyRoles(person).map((item) => roleLevels[item] ?? 4), roleLevels[person.role] ?? 4) < selectedRank)));

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
    if (restrictedReportingRoles.has(nextRole)) {
      const selectedManager = members.find((person) => person.id === managerId);
      if (!canSuperviseCampaignOrSenior(selectedManager)) setManagerId("");
    }
    if (nextRole === "Customer Rep" && !managerId) {
      setManagerId(members.find((person) => person.role === "Senior Agent")?.id ?? "");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const cleanedName = name.trim();
    if (!cleanedName) return;
    if (restrictedReportingRoles.has(role) && !canSuperviseCampaignOrSenior(members.find((person) => person.id === managerId))) {
      setSaveError("Campaign Specialists and Senior Agents must report directly to a Team Lead or Senior Team Lead (STL).");
      return;
    }
    setSaving(true); setSaveError("");
    try {
      await onSave({
        ...(member?.id ? { id: member.id } : {}),
        name: cleanedName,
        role,
        hierarchyRoles,
        managerId: managerId || null,
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
          <label className="form-field">
            <span>Reports to {restrictedReportingRoles.has(role) && <small>(Team Lead or STL required)</small>}</span>
            <select value={managerId} onChange={(event) => setManagerId(event.target.value)}>
              <option value="">{restrictedReportingRoles.has(role) ? "Select a Team Lead or STL" : "No manager"}</option>
              {managerOptions.map((person) => <option key={person.id} value={person.id}>{person.name} · {getOrganizationRoleLabels(person).join(" / ")}</option>)}
            </select>
            {restrictedReportingRoles.has(role) && managerOptions.length === 0 && <small className="form-field-hint">Add or assign a Team Lead / STL before saving this role.</small>}
          </label>
          {role === "Customer Rep" && (
            <label className="form-field">
              <span>Mentor <small>(optional)</small></span>
              <select value={mentorId} onChange={(event) => setMentorId(event.target.value)}>
                <option value="">No mentor selected</option>
                {campaignSpecialists.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>
          )}
          {saveError && <p className="form-error" role="alert">{saveError}</p>}
          <div className="dialog-actions">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || (restrictedReportingRoles.has(role) && managerOptions.length === 0)}>{saving ? "Saving…" : member ? "Save changes" : "Add employee"}</Button>
          </div>
        </form>
      </section>
    </div>
  );
}
