import { useEffect, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { organizationRoles, getDescendantIds } from "@/features/organization/organization-data";
import { Button } from "@/components/ui/Button";

function getInitials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function resizePhoto(file) {
  return new Promise((resolve, reject) => {
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
  const defaultManagerId = member?.managerId ?? (defaultRole === "Customer Rep" ? members.find((person) => person.role === "Senior Agent")?.id ?? "" : "");
  const [name, setName] = useState(member?.name ?? "");
  const [role, setRole] = useState(defaultRole);
  const [managerId, setManagerId] = useState(defaultManagerId);
  const campaignSpecialists = members.filter((person) => person.role === "Campaign Specialist" && person.id !== member?.id);
  const [mentorId, setMentorId] = useState(member?.mentorId ?? "");
  const [photo, setPhoto] = useState(member?.photo ?? "");
  const [photoError, setPhotoError] = useState("");
  const excludedManagerIds = member ? getDescendantIds(members, member.id) : new Set();
  const roleLevels = { "Team Lead": 0, "Campaign Specialist": 1, "Senior Agent": 2, "Customer Rep": 3 };
  const managerOptions = members.filter((person) => person.id !== member?.id
    && !excludedManagerIds.has(person.id)
    && (person.id === member?.managerId || roleLevels[person.role] < roleLevels[role]));

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
    if (nextRole === "Customer Rep" && !managerId) {
      setManagerId(members.find((person) => person.role === "Senior Agent")?.id ?? "");
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    const cleanedName = name.trim();
    if (!cleanedName) return;
    onSave({
      ...(member?.id ? { id: member.id } : {}),
      name: cleanedName,
      role,
      managerId: managerId || null,
      mentorId: role === "Customer Rep" ? (mentorId || null) : null,
      photo,
    });
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
            <span>Role</span>
            <select value={role} onChange={handleRoleChange}>
              {organizationRoles.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="form-field">
            <span>Reports to</span>
            <select value={managerId} onChange={(event) => setManagerId(event.target.value)}>
              <option value="">No manager</option>
              {managerOptions.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}
            </select>
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
          <div className="dialog-actions">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">{member ? "Save changes" : "Add employee"}</Button>
          </div>
        </form>
      </section>
    </div>
  );
}
