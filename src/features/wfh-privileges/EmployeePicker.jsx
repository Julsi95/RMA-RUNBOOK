import { useMemo, useState } from "react";
import { Check, Search, UsersRound, X } from "lucide-react";

function initials(name) {
  return String(name ?? "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function EmployeePicker({ members, value, onChange }) {
  const [search, setSearch] = useState("");
  const selectedIds = new Set(value);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return members
      .filter((member) => !term || (member.name + " " + (member.role ?? "")).toLocaleLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [members, search]);
  const selected = useMemo(() => members.filter((member) => selectedIds.has(member.id)), [members, value]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((member) => selectedIds.has(member.id));

  function toggle(id) {
    onChange(selectedIds.has(id) ? value.filter((item) => item !== id) : [...value, id]);
  }

  function toggleFiltered() {
    if (allFilteredSelected) {
      const filteredIds = new Set(filtered.map((member) => member.id));
      onChange(value.filter((id) => !filteredIds.has(id)));
    } else {
      onChange([...new Set([...value, ...filtered.map((member) => member.id)])]);
    }
  }

  return (
    <div className="employee-picker">
      <div className="employee-picker-topline">
        <span className="employee-picker-label">Employees</span>
        <span className="employee-picker-count">{value.length} selected</span>
      </div>
      <label className="employee-picker-search">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          aria-label="Search employees"
          placeholder="Find a name or role"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {search && <button type="button" aria-label="Clear search" onClick={() => setSearch("")}><X size={14} /></button>}
      </label>
      <div className="employee-picker-toolbar">
        <span><UsersRound size={13} /> {filtered.length} {filtered.length === 1 ? "person" : "people"}</span>
        <button type="button" disabled={!filtered.length} onClick={toggleFiltered}>
          {allFilteredSelected ? "Clear shown" : "Select shown"}
        </button>
      </div>
      <div className="employee-picker-options" role="group" aria-label="Choose employees to receive WFH days">
        {filtered.length ? filtered.map((member) => {
          const checked = selectedIds.has(member.id);
          return (
            <button
              key={member.id}
              type="button"
              className={"employee-picker-option" + (checked ? " is-selected" : "")}
              aria-pressed={checked}
              onClick={() => toggle(member.id)}
            >
              <span className="employee-picker-avatar" aria-hidden="true">{initials(member.name)}</span>
              <span className="employee-picker-person"><strong>{member.name}</strong><small>{member.role || "Employee"}</small></span>
              <span className="employee-picker-check" aria-hidden="true">{checked && <Check size={13} />}</span>
            </button>
          );
        }) : <p className="employee-picker-empty">No employees match “{search}”.</p>}
      </div>
      {selected.length > 0 && (
        <div className="employee-picker-selected" aria-label="Selected employees">
          {selected.map((member) => (
            <button key={member.id} type="button" onClick={() => toggle(member.id)} aria-label={"Remove " + member.name}>
              <span>{member.name}</span><X size={12} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
