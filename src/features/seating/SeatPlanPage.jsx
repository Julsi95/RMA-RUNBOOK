import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Armchair, BriefcaseBusiness, CalendarDays, Grip, Plus, Printer, Search, Trash2, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { starterMembers } from "@/features/organization/organization-data";
import { getOrganizationRoleLabels } from "@/features/organization/organization-data";
import { useOrganizationRoster } from "@/app/organization-provider";
import { useAuth } from "@/app/auth-provider";
import { isSupabaseConfigured } from "@/lib/supabase";
import { loadSeatPlans, saveSeatPlan } from "@/lib/backend-repositories";
import { retryDataLoad, subscribeToTables } from "@/lib/backend/shared";
import { fetchCachedQuery, queryClient, queryKeys, readCachedQuery } from "@/lib/backend/query-cache";

const PLAN_STORAGE_KEY = "starter-app-seat-plans-v1";
const TEAM_STORAGE_KEY = "starter-app-organization-members-v2";
const seatColumns = [1, 2, 3, 4];
const initialSeatIds = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4"];
const initialLeadershipSeatIds = ["LEAD-1", "LEAD-2", "LEAD-3", "LEAD-4"];
const emptyPlan = { note: "", assignments: {}, seatIds: initialSeatIds, leadershipSeatIds: initialLeadershipSeatIds };

function getLocalDate() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function getSavedPlans() {
  try {
    const saved = localStorage.getItem(PLAN_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([date, plan]) => {
      const legacyAssignedSeats = Object.keys(plan?.assignments ?? {}).filter((seatId) => /^[A-Z]+\d+$/.test(seatId));
      const seatIds = Array.isArray(plan?.seatIds) ? plan.seatIds : [...new Set([...initialSeatIds, ...legacyAssignedSeats])];
      const leadershipSeatIds = Array.isArray(plan?.leadershipSeatIds) ? plan.leadershipSeatIds : initialLeadershipSeatIds;
      const seatSet = new Set([...seatIds, ...leadershipSeatIds]);
      const assignments = Object.fromEntries(Object.entries(plan?.assignments ?? {}).filter(([seatId]) => seatSet.has(seatId)));
      return [date, { ...plan, seatIds, leadershipSeatIds, assignments }];
    }));
  } catch {
    return {};
  }
}

function getTeamMembers() {
  try {
    const saved = localStorage.getItem(TEAM_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : null;
    return Array.isArray(parsed) ? parsed : starterMembers;
  } catch {
    return starterMembers;
  }
}

function getInitials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function rowLabel(rowIndex) {
  let value = rowIndex + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function getSeatPosition(seatId) {
  const match = seatId.match(/^([A-Z]+)(\d+)$/);
  if (!match) return { rowIndex: 0, column: 1 };
  const rowIndex = [...match[1]].reduce((index, character) => index * 26 + character.charCodeAt(0) - 64, 0) - 1;
  return { rowIndex, column: Number(match[2]) };
}

export default function SeatPlanPage() {
  const { members: teamMembers } = useOrganizationRoster();
  const { canEdit, user } = useAuth();
  const resourceKey = useMemo(() => queryKeys.seatPlans(user?.id ?? "anonymous", canEdit), [canEdit, user?.id]);
  const cachedPlans = readCachedQuery(resourceKey);
  const [selectedDate, setSelectedDate] = useState(getLocalDate);
  const [plans, setPlans] = useState(() => isSupabaseConfigured ? cachedPlans ?? {} : getSavedPlans());
  const [remoteReady, setRemoteReady] = useState(Boolean(cachedPlans));
  const [syncError, setSyncError] = useState("");
  const remoteSnapshotRef = useRef(cachedPlans ? structuredClone(cachedPlans) : null);
  const canManage = canEdit && (!isSupabaseConfigured || Boolean(remoteSnapshotRef.current));
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [selectedSeatId, setSelectedSeatId] = useState(null);
  const [draggingMemberId, setDraggingMemberId] = useState(null);
  const [dragPreviewPosition, setDragPreviewPosition] = useState(null);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const activePlan = plans[selectedDate] ?? emptyPlan;
  const assignments = activePlan.assignments ?? {};
  const seatIds = activePlan.seatIds ?? initialSeatIds;
  const leadershipSeatIds = activePlan.leadershipSeatIds ?? initialLeadershipSeatIds;
  const allSeatIds = [...leadershipSeatIds, ...seatIds];

  useEffect(() => {
    if (!isSupabaseConfigured) {
      localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plans));
      return undefined;
    }
    let active = true;
    void fetchCachedQuery(resourceKey, () => retryDataLoad(loadSeatPlans)).then((saved) => {
      if (!active) return;
      remoteSnapshotRef.current = structuredClone(saved);
      setPlans(saved);
      setRemoteReady(true);
      setSyncError("");
    }).catch((error) => { if (active) setSyncError(error.message || "Could not load saved seat plans."); });
    return () => { active = false; };
  }, [resourceKey]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    let timer;
    const unsubscribe = subscribeToTables(["seat_plans", "seat_positions", "seat_assignments"], () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void fetchCachedQuery(resourceKey, () => retryDataLoad(loadSeatPlans), { force: true }).then((saved) => {
        if (!active) return;
        remoteSnapshotRef.current = structuredClone(saved); setPlans(saved); setSyncError("");
      }).catch((error) => { if (active) setSyncError(error.message || "Could not sync seat plan changes."); }); }, 180);
    }, "seat-plan");
    return () => { active = false; window.clearTimeout(timer); unsubscribe(); };
  }, [resourceKey]);

  useEffect(() => {
    if (!isSupabaseConfigured || !remoteReady || !canEdit || !remoteSnapshotRef.current) return undefined;
    const pending = Object.entries(plans).filter(([date, plan]) => JSON.stringify(plan) !== JSON.stringify(remoteSnapshotRef.current?.[date]));
    if (!pending.length) return undefined;
    const timeout = window.setTimeout(async () => {
      try {
        await Promise.all(pending.map(([date, plan]) => saveSeatPlan(date, plan)));
        remoteSnapshotRef.current = { ...(remoteSnapshotRef.current ?? {}), ...Object.fromEntries(pending) };
        queryClient.setQueryData(resourceKey, remoteSnapshotRef.current);
        setSyncError("");
      } catch (error) {
        setSyncError(error.message || "Could not save seat plan changes.");
      }
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [plans, remoteReady, canEdit, resourceKey]);

  const membersById = useMemo(() => new Map(teamMembers.map((member) => [member.id, member])), [teamMembers]);
  const assignedIds = new Set(Object.values(assignments));
  const availableMembers = teamMembers
    .filter((member) => !assignedIds.has(member.id))
    .filter((member) => `${member.name} ${getOrganizationRoleLabels(member).join(" ")}`.toLowerCase().includes(searchTerm.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const assignedCount = allSeatIds.filter((seatId) => membersById.has(assignments[seatId])).length;
  const openCount = Math.max(0, allSeatIds.length - assignedCount);
  const rowsByIndex = new Map();
  for (const seatId of seatIds) {
    const { rowIndex, column } = getSeatPosition(seatId);
    if (!rowsByIndex.has(rowIndex)) rowsByIndex.set(rowIndex, new Map());
    rowsByIndex.get(rowIndex).set(column, seatId);
  }
  const maxRowIndex = Math.max(-1, ...rowsByIndex.keys());
  const seatPairs = [];
  for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex += 2) {
    const pair = [rowIndex, rowIndex + 1].filter((index) => index <= maxRowIndex && rowsByIndex.has(index));
    if (pair.length) seatPairs.push(pair);
  }

  function updateActivePlan(updater) {
    if (!canManage) return;
    setPlans((current) => {
      const plan = current[selectedDate] ?? emptyPlan;
      return { ...current, [selectedDate]: updater(plan) };
    });
  }

  function assignMember(memberId, seatId) {
    updateActivePlan((plan) => {
      const nextAssignments = { ...plan.assignments };
      for (const [currentSeatId, currentMemberId] of Object.entries(nextAssignments)) {
        if (currentMemberId === memberId) delete nextAssignments[currentSeatId];
      }
      nextAssignments[seatId] = memberId;
      return { ...plan, assignments: nextAssignments };
    });
    setSelectedMemberId(null);
    setSelectedSeatId(null);
  }

  function moveSeat(fromSeatId, toSeatId) {
    if (!fromSeatId || fromSeatId === toSeatId) return;
    updateActivePlan((plan) => {
      const nextAssignments = { ...plan.assignments };
      const movingMember = nextAssignments[fromSeatId];
      if (!movingMember) return plan;
      const displacedMember = nextAssignments[toSeatId];
      if (displacedMember) nextAssignments[fromSeatId] = displacedMember;
      else delete nextAssignments[fromSeatId];
      nextAssignments[toSeatId] = movingMember;
      return { ...plan, assignments: nextAssignments };
    });
    setSelectedSeatId(null);
    setSelectedMemberId(null);
  }

  function clearSeat(seatId) {
    updateActivePlan((plan) => {
      const nextAssignments = { ...plan.assignments };
      delete nextAssignments[seatId];
      return { ...plan, assignments: nextAssignments };
    });
    setSelectedSeatId(null);
  }

  function addSeat() {
    const existingSeats = new Set(seatIds);
    let nextSeatId = "";
    for (let position = 0; !nextSeatId; position += 1) {
      const candidate = `${rowLabel(Math.floor(position / 4))}${(position % 4) + 1}`;
      if (!existingSeats.has(candidate)) nextSeatId = candidate;
    }
    updateActivePlan((plan) => ({ ...plan, seatIds: [...(plan.seatIds ?? initialSeatIds), nextSeatId] }));
  }

  function addLeadershipSeat() {
    const existingSeats = new Set(leadershipSeatIds);
    let nextSeatId = "";
    for (let number = 1; !nextSeatId; number += 1) {
      const candidate = `LEAD-${number}`;
      if (!existingSeats.has(candidate)) nextSeatId = candidate;
    }
    updateActivePlan((plan) => ({ ...plan, leadershipSeatIds: [...(plan.leadershipSeatIds ?? initialLeadershipSeatIds), nextSeatId] }));
  }

  function removeSeat(seatId) {
    updateActivePlan((plan) => {
      const nextAssignments = { ...plan.assignments };
      delete nextAssignments[seatId];
      const isLeadershipSeat = seatId.startsWith("LEAD-");
      return {
        ...plan,
        seatIds: isLeadershipSeat ? (plan.seatIds ?? initialSeatIds) : (plan.seatIds ?? initialSeatIds).filter((id) => id !== seatId),
        leadershipSeatIds: isLeadershipSeat ? (plan.leadershipSeatIds ?? initialLeadershipSeatIds).filter((id) => id !== seatId) : (plan.leadershipSeatIds ?? initialLeadershipSeatIds),
        assignments: nextAssignments,
      };
    });
    if (selectedSeatId === seatId) setSelectedSeatId(null);
    setSelectedMemberId(null);
  }

  function selectSeat(seatId) {
    if (selectedMemberId) {
      assignMember(selectedMemberId, seatId);
      return;
    }
    if (selectedSeatId && selectedSeatId !== seatId) {
      if (assignments[selectedSeatId]) moveSeat(selectedSeatId, seatId);
      else setSelectedSeatId(seatId);
      return;
    }
    setSelectedSeatId((current) => current === seatId ? null : seatId);
  }

  function handlePersonClick(memberId) {
    if (selectedSeatId) {
      assignMember(memberId, selectedSeatId);
      return;
    }
    setSelectedMemberId((current) => current === memberId ? null : memberId);
  }

  function startPointerDrag(event, payload) {
    if (!canManage) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragRef.current = { ...payload, startX: event.clientX, startY: event.clientY, moved: false };
  }

  function updatePointerDrag(event) {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 7) {
      drag.moved = true;
      setDraggingMemberId(drag.memberId);
    }
    if (drag.moved) setDragPreviewPosition({ x: event.clientX, y: event.clientY });
  }

  function finishPointerDrag(event) {
    const drag = dragRef.current;
    if (!drag) return;
    const dropTarget = event.target.closest?.("[data-seat-drop-id], [data-pool-drop]");
    if (drag.moved) {
      event.preventDefault();
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      if (dropTarget?.dataset.seatDropId) {
        if (drag.fromSeatId) moveSeat(drag.fromSeatId, dropTarget.dataset.seatDropId);
        else assignMember(drag.memberId, dropTarget.dataset.seatDropId);
      } else if (dropTarget?.hasAttribute("data-pool-drop") && drag.fromSeatId) {
        clearSeat(drag.fromSeatId);
      }
    }
    dragRef.current = null;
    setDraggingMemberId(null);
    setDragPreviewPosition(null);
  }

  function handleSeatClick(seatId) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    selectSeat(seatId);
  }

  function handlePersonClickWithDrag(memberId) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    handlePersonClick(memberId);
  }

  function renderSeat(seatId, facing = "south") {
    const member = membersById.get(assignments[seatId]);
    const isSelected = selectedSeatId === seatId;
    return (
      <button
        className={`seat-position ${member ? "seat-position-assigned" : "seat-position-open"} ${isSelected ? "seat-position-selected" : ""} ${draggingMemberId === member?.id ? "seat-position-dragging" : ""} ${facing === "north" ? "seat-face-north" : "seat-face-south"}`}
        key={seatId}
        type="button"
        aria-label={`${seatId}, ${member ? `${member.name}, ${getOrganizationRoleLabels(member).join(", ")}` : "open seat"}${member?.mentorName ? `, mentor ${member.mentorName}` : ""}`}
        title={selectedMemberId ? `Assign selected teammate to ${seatId}` : `Select seat ${seatId}`}
        data-seat-drop-id={seatId}
        disabled={!canManage}
        onPointerDown={(event) => { if (member) startPointerDrag(event, { memberId: member.id, fromSeatId: seatId }); }}
        onClick={() => handleSeatClick(seatId)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectSeat(seatId); }
        }}
      >
        {facing !== "north" && <span className="seat-chair"><Armchair size={19} strokeWidth={1.6} /></span>}
        <span className="seat-desk">
          <span className="seat-desk-topline"><span className="seat-code">{seatId.startsWith("LEAD-") ? `LEAD ${seatId.slice(5)}` : seatId}</span>{member && <Grip className="seat-grip" size={13} />}</span>
          {member ? (
            <span className="seat-occupant">
              <span className="seat-mini-avatar">{member.photo ? <img src={member.photo} alt="" /> : getInitials(member.name)}</span>
              <span className="seat-occupant-copy"><strong>{member.name}</strong><small>{getOrganizationRoleLabels(member).join(" · ")}</small>{member.mentorName && <small className="seat-mentor-label">Mentor · {member.mentorName}</small>}</span>
            </span>
          ) : (
            <span className="seat-empty-label"><span className="seat-empty-plus">+</span>{selectedSeatId === seatId ? "Seat selected" : "Open seat"}</span>
          )}
          {canManage && <span className="seat-remove" role="presentation" title={`Remove seat ${seatId}${member ? ` and return ${member.name} to the available list` : ""}`} onClick={(event) => { event.stopPropagation(); removeSeat(seatId); }} onMouseDown={(event) => event.stopPropagation()}><Trash2 size={12} /></span>}
        </span>
        {facing === "north" && <span className="seat-chair"><Armchair size={19} strokeWidth={1.6} /></span>}
      </button>
    );
  }

  function setNote(value) {
    updateActivePlan((plan) => ({ ...plan, note: value }));
  }

  const printableDate = new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(`${selectedDate}T12:00:00`));

  return (
    <section className="page-content seat-plan-page" onPointerMove={updatePointerDrag} onPointerUp={finishPointerDrag} onPointerCancel={() => { dragRef.current = null; setDraggingMemberId(null); setDragPreviewPosition(null); }}>
      {draggingMemberId && dragPreviewPosition && (() => {
        const member = membersById.get(draggingMemberId);
        if (!member) return null;
        return createPortal(<div className="seat-drag-preview" style={{ left: dragPreviewPosition.x + 14, top: dragPreviewPosition.y + 14 }} aria-hidden="true">
          <span className="pool-avatar">{member.photo ? <img src={member.photo} alt="" /> : getInitials(member.name)}</span>
          <span className="available-person-copy"><strong>{member.name}</strong><small>{getOrganizationRoleLabels(member).join(" · ")}</small></span>
          <Grip className="pool-grip" size={15} />
        </div>, document.body);
      })()}
      <div className="page-heading seat-page-heading">
        <div>
          <p className="eyebrow">WORKSPACE PLANNING</p>
          <h1>Seat plan</h1>
          <p className="page-description">Arrange your team around a shared back-to-back desk layout.</p>
        </div>
        <Button variant="outline" className="seat-print-button" onClick={() => window.print()}><Printer size={16} /> Print plan</Button>
      </div>

      <div className="seat-plan-controls">
        <label className="seat-date-field">
          <span className="seat-control-icon"><CalendarDays size={17} /></span>
          <span><small>Seat plan for</small><input type="date" value={selectedDate} onChange={(event) => { if (event.target.value) setSelectedDate(event.target.value); setSelectedSeatId(null); setSelectedMemberId(null); }} /></span>
        </label>
        <div className="seat-plan-status"><span className="seat-status-dot" />{syncError ? "Sync issue" : isSupabaseConfigured ? remoteReady ? canEdit ? "Synced with workspace" : "Shared workspace" : "Loading plans…" : "Saved in this browser"}</div>
      </div>
      {syncError && <p className="auth-error" role="alert">{syncError}</p>}

      <div className="seat-stats-grid">
        <div className="seat-stat-card"><span className="seat-stat-icon"><Armchair size={17} /></span><span><strong>{allSeatIds.length}</strong><small>Total seats</small></span></div>
        <div className="seat-stat-card"><span className="seat-stat-icon seat-stat-icon-filled"><UsersRound size={17} /></span><span><strong>{assignedCount}</strong><small>Assigned</small></span><div className="seat-stat-meter"><i style={{ width: `${allSeatIds.length ? (assignedCount / allSeatIds.length) * 100 : 0}%` }} /></div></div>
        <div className="seat-stat-card"><span className="seat-stat-icon"><Grip size={17} /></span><span><strong>{openCount}</strong><small>Open seats</small></span></div>
      </div>

      <div className="seat-plan-layout">
        <section className="seat-map-panel">
          <div className="seat-panel-heading">
            <div><p className="eyebrow">FLOOR LAYOUT</p><h2>Seat plan for {printableDate}</h2></div>
          <div className="seat-map-actions"><span className="seat-layout-badge">{allSeatIds.length} seats <i /> Leadership + team</span>{canManage && <Button variant="outline" className="seat-add-button" onClick={addSeat}><Plus size={15} /> Add team seat</Button>}</div>
          </div>
          <div className="seat-map-legend"><span><i className="legend-chair-icon" /> Chair</span><span><i className="legend-desk-icon" /> Desk & assigned teammate</span><span><i className="legend-open-icon" /> Open seat</span></div>

          <div className="seat-room-wrap">
            <div className="seat-room-label"><span>WINDOWS</span><i /></div>
            <div className="seat-room">
              <div className="seat-leadership-layer">
                <div className="seat-leadership-heading"><div><span className="seat-leadership-icon"><BriefcaseBusiness size={15} /></span><span><strong>Team Lead / Boss</strong><small>Leadership seats</small></span></div><div className="seat-leadership-actions"><span>{leadershipSeatIds.length} seats</span>{canManage && <Button variant="outline" className="seat-add-button" onClick={addLeadershipSeat}><Plus size={14} /> Add</Button>}</div></div>
                {leadershipSeatIds.length > 0 ? <div className="seat-leadership-row">{leadershipSeatIds.map((seatId) => renderSeat(seatId))}</div> : <div className="seat-leadership-empty">No leadership seats yet. Add one to restore the row.</div>}
              </div>
              {seatPairs.length ? seatPairs.map((pairRows, pairIndex) => (
                <div className="seat-pair" key={pairIndex}>
                  {pairRows.map((rowIndex) => (
                    <div className={`seat-row ${rowIndex % 2 === 0 ? "seat-row-face-south" : "seat-row-face-north"}`} key={rowIndex}>
                      {seatColumns.map((column) => {
                        const seatId = rowsByIndex.get(rowIndex)?.get(column);
                        if (!seatId) return <span className="seat-empty-slot" key={`${rowIndex}-${column}`} aria-hidden="true" />;
                        return renderSeat(seatId, rowIndex % 2 === 1 ? "north" : "south");
                      })}
                    </div>
                  ))}
                </div>
              )) : seatIds.length === 0 ? <div className="seat-map-empty"><Armchair size={22} /><strong>No team seats in this plan</strong><span>Add a seat to start arranging the floor.</span></div> : null}
            </div>
            <div className="seat-room-label seat-room-label-bottom"><span>ENTRY</span><i /></div>
          </div>
          <div className="seat-pair-note"><span className="seat-pair-line" /> Paired desks face away from one another, with an open aisle between banks.</div>
        </section>

        <aside className="seat-note-panel">
          <div className="seat-note-heading"><span className="seat-note-icon"><CalendarDays size={16} /></span><div><h2>Plan notes</h2><p>Saved separately for each date.</p></div></div>
          <label className="seat-note-label" htmlFor="seat-plan-note">Notes for {printableDate}</label>
          <textarea id="seat-plan-note" value={activePlan.note ?? ""} onChange={(event) => setNote(event.target.value)} placeholder={canManage ? "Add a note for this day…&#10;Example: Training at the front row" : "No notes for this day"} maxLength={500} readOnly={!canManage} />
          <div className="seat-note-footer"><span>{(activePlan.note ?? "").length}/500</span><span>Autosaved</span></div>
        </aside>
      </div>

      <section className={`team-pool-panel ${selectedSeatId ? "team-pool-target-active" : ""}`} data-pool-drop>
        <div className="team-pool-heading">
          <div><span className="team-pool-icon"><UsersRound size={17} /></span><div><h2>Available team members</h2><p>{selectedSeatId ? `Choose a teammate for seat ${selectedSeatId}, or drag a name onto it.` : "Drag someone to a seat, or select a seat and click a name."}</p></div></div>
          <div className="team-pool-search"><Search size={15} /><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Find a teammate" aria-label="Search available teammates" /></div>
        </div>
        <div className="team-pool-drop-hint"><Grip size={14} /> Drop a seated teammate here to make them available again</div>
        {availableMembers.length > 0 ? (
          <div className="available-people-grid">
            {availableMembers.map((member) => (
              <button
                className={`available-person ${selectedMemberId === member.id ? "available-person-selected" : ""} ${draggingMemberId === member.id ? "is-dragging" : ""}`}
                key={member.id}
                type="button"
                disabled={!canManage}
                onPointerDown={(event) => startPointerDrag(event, { memberId: member.id, fromSeatId: null })}
                onClick={() => handlePersonClickWithDrag(member.id)}
              >
                <span className="pool-avatar">{member.photo ? <img src={member.photo} alt="" /> : getInitials(member.name)}</span>
                <span className="available-person-copy"><strong>{member.name}</strong><small>{getOrganizationRoleLabels(member).join(" · ")}</small></span>
                <Grip className="pool-grip" size={14} />
              </button>
            ))}
          </div>
        ) : (
          <div className="team-pool-empty">{teamMembers.length === assignedCount ? "Everyone is seated for this date." : "No available teammates match your search."}</div>
        )}
        {selectedSeatId && <button className="cancel-seat-selection" type="button" onClick={() => { setSelectedSeatId(null); setSelectedMemberId(null); }}>Cancel seat selection</button>}
      </section>
    </section>
  );
}
