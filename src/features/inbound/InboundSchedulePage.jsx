import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, CalendarDays, Clock3, Plus, Trash2, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { getOrganizationMembers } from "@/features/organization/organization-data";
import "@/features/inbound/inbound-schedule.css";

const STORAGE_KEY = "starter-app-inbound-schedule-v1";
const MANILA_ZONE = "Asia/Manila";
const NORTH_AMERICA_ZONES = [
  { id: "America/New_York", label: "Eastern · New York / Toronto" },
  { id: "America/Chicago", label: "Central · Chicago / Winnipeg" },
  { id: "America/Denver", label: "Mountain · Denver" },
  { id: "America/Phoenix", label: "Arizona · Phoenix" },
  { id: "America/Los_Angeles", label: "Pacific · Los Angeles / Vancouver" },
  { id: "America/Anchorage", label: "Alaska · Anchorage" },
  { id: "Pacific/Honolulu", label: "Hawaii · Honolulu" },
];
function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function createMonthSchedule(members) {
  return {
    callWindow: { start: "21:00", end: "06:00" },
    callAssignments: [],
    workPreset: "9-6",
    workSchedules: members.map((member) => ({
      id: `work-${member.id}`,
      memberId: member.id,
      start: "21:00",
      end: "06:00",
    })),
  };
}

function readSavedSchedules() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `schedule-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "?";
}

function timeLabel(value) {
  if (!/^\d{2}:\d{2}$/.test(value ?? "")) return "—";
  const [rawHour, minute] = value.split(":").map(Number);
  const suffix = rawHour >= 12 ? "PM" : "AM";
  const hour = rawHour % 12 || 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function timeMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(value ?? "")) return 0;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function rangeMinutes(start, end) {
  const length = (timeMinutes(end) - timeMinutes(start) + 1440) % 1440;
  return length || 1440;
}

function offsetFrom(start, value) {
  return (timeMinutes(value) - timeMinutes(start) + 1440) % 1440;
}

function timeAfter(start, minutes) {
  const total = (timeMinutes(start) + Math.round(minutes)) % 1440;
  return timeLabel(`${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`);
}

function datePlusOne(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function zonedParts(date, timeZone) {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(values.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function localTimeToInstant(dateString, timeString, timeZone) {
  const [year, month, day] = dateString.split("-").map(Number);
  const [hour, minute] = timeString.split(":").map(Number);
  const expected = Date.UTC(year, month - 1, day, hour, minute);
  let instant = expected;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(instant), timeZone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const correction = expected - represented;
    instant += correction;
    if (!correction) break;
  }
  return new Date(instant);
}

function convertedRange(start, end, date, timeZone) {
  if (!/^\d{2}:\d{2}$/.test(start ?? "") || !/^\d{2}:\d{2}$/.test(end ?? "")) return "Choose both times";
  const endDate = timeMinutes(end) <= timeMinutes(start) ? datePlusOne(date) : date;
  const startInstant = localTimeToInstant(date, start, MANILA_ZONE);
  const endInstant = localTimeToInstant(endDate, end, MANILA_ZONE);
  const dateFormatter = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" });
  const timeFormatter = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const startDate = dateFormatter.format(startInstant);
  const endDateLabel = dateFormatter.format(endInstant);
  return `${startDate} ${timeFormatter.format(startInstant)} – ${startDate === endDateLabel ? "" : `${endDateLabel} `}${timeFormatter.format(endInstant)}`;
}

function rangeLabel(start, end) {
  return `${timeLabel(start)} – ${timeLabel(end)}`;
}

function durationLabel(start, end) {
  if (!/^\d{2}:\d{2}$/.test(start ?? "") || !/^\d{2}:\d{2}$/.test(end ?? "")) return "—";
  const minutes = rangeMinutes(start, end);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h${remainder ? ` ${remainder}m` : ""}`;
}

function Avatar({ name, photo }) {
  return <span className="inbound-avatar">{photo ? <img src={photo} alt="" /> : initials(name)}</span>;
}

export default function InboundSchedulePage() {
  const members = useMemo(() => getOrganizationMembers(), []);
  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const [month, setMonth] = useState(currentMonth);
  const [savedSchedules, setSavedSchedules] = useState(readSavedSchedules);
  const [northAmericaZone, setNorthAmericaZone] = useState("America/New_York");
  const [timeView, setTimeView] = useState("ph");
  const [previewDate, setPreviewDate] = useState(() => `${currentMonth()}-${String(new Date().getDate()).padStart(2, "0")}`);
  const [newCallMemberId, setNewCallMemberId] = useState("");
  const [newCallStart, setNewCallStart] = useState("21:00");
  const [newCallEnd, setNewCallEnd] = useState("22:30");

  const monthSchedule = savedSchedules[month] ?? createMonthSchedule(members);
  const callAssignments = monthSchedule.callAssignments ?? [];
  const callWindow = monthSchedule.callWindow ?? { start: "21:00", end: "06:00" };
  const usedCallMemberIds = new Set(callAssignments.map((item) => item.memberId));
  const availableCallMembers = members.filter((member) => !usedCallMemberIds.has(member.id));

  useEffect(() => {
    if (!savedSchedules[month]) {
      setSavedSchedules((current) => ({ ...current, [month]: createMonthSchedule(members) }));
    }
  }, [month, members, savedSchedules]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedSchedules));
    } catch {
      // The page remains usable for this session if browser storage is unavailable.
    }
  }, [savedSchedules]);

  useEffect(() => {
    if (!availableCallMembers.some((member) => member.id === newCallMemberId)) {
      setNewCallMemberId(availableCallMembers[0]?.id ?? "");
    }
  }, [availableCallMembers, newCallMemberId]);

  function updateSchedule(updater) {
    setSavedSchedules((current) => {
      const base = current[month] ?? createMonthSchedule(members);
      return { ...current, [month]: typeof updater === "function" ? updater(base) : { ...base, ...updater } };
    });
  }

  function updateCallAssignment(id, patch) {
    updateSchedule((current) => ({
      ...current,
      callAssignments: current.callAssignments.map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  }

  function changeCallAssignee(assignmentId, nextMemberId) {
    const selectedAssignment = callAssignments.find((item) => item.id === assignmentId);
    if (!selectedAssignment || selectedAssignment.memberId === nextMemberId) return;
    const assignmentToSwap = callAssignments.find((item) => item.id !== assignmentId && item.memberId === nextMemberId);
    updateSchedule((current) => ({
      ...current,
      callAssignments: current.callAssignments.map((item) => {
        if (item.id === assignmentId) return { ...item, memberId: nextMemberId };
        if (assignmentToSwap && item.id === assignmentToSwap.id) return { ...item, memberId: selectedAssignment.memberId };
        return item;
      }),
    }));
  }

  function removeCallAssignment(id) {
    const hasOneLeft = callAssignments.length === 1;
    updateSchedule((current) => ({
      ...current,
      callAssignments: current.callAssignments.filter((item) => item.id !== id),
    }));
    if (hasOneLeft) {
      setNewCallStart(callWindow.start);
      const end = (timeMinutes(callWindow.start) + 90) % 1440;
      setNewCallEnd(`${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`);
    }
  }

  function addCallAssignment() {
    if (!newCallMemberId) return;
    updateSchedule((current) => ({
      ...current,
      callAssignments: [...current.callAssignments, { id: makeId(), memberId: newCallMemberId, start: newCallStart, end: newCallEnd }],
    }));
    setNewCallStart(newCallEnd);
    setNewCallEnd((value) => {
      const next = (timeMinutes(value) + 90) % 1440;
      return `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
    });
  }

  function changeMonth(nextMonth) {
    if (!nextMonth) return;
    setMonth(nextMonth);
    setPreviewDate(`${nextMonth}-01`);
  }

  const callWindowDuration = rangeMinutes(callWindow.start, callWindow.end);
  const timelineLabels = [timeLabel(callWindow.start), timeAfter(callWindow.start, callWindowDuration / 3), timeAfter(callWindow.start, callWindowDuration * 2 / 3), timeLabel(callWindow.end)];
  const timezoneLabel = NORTH_AMERICA_ZONES.find((zone) => zone.id === northAmericaZone)?.label.split(" · ")[0] ?? "North America";

  return (
    <section className="page-content inbound-page">
      <div className="page-heading inbound-heading">
        <div><p className="eyebrow">OPERATIONS</p><h1>Inbound call time</h1></div>
      </div>

      <div className="inbound-toolbar">
        <label className="inbound-control inbound-month-control"><CalendarDays size={16} /><span>Month</span><input type="month" value={month} onChange={(event) => changeMonth(event.target.value)} aria-label="Schedule month" /></label>
        <label className="inbound-control inbound-zone-control"><span>North America</span><Select value={northAmericaZone} onValueChange={setNorthAmericaZone}><SelectTrigger aria-label="North American timezone"><SelectValue /></SelectTrigger><SelectContent>{NORTH_AMERICA_ZONES.map((zone) => <SelectItem key={zone.id} value={zone.id}>{zone.label}</SelectItem>)}</SelectContent></Select></label>
        <label className="inbound-control inbound-date-control"><span>Preview date</span><input type="date" value={previewDate} min={`${month}-01`} max={`${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()}`} onChange={(event) => setPreviewDate(event.target.value)} aria-label="Timezone conversion preview date" /></label>
        <div className="inbound-view-toggle" role="group" aria-label="Primary time display">
          <button type="button" className={timeView === "ph" ? "active" : ""} onClick={() => setTimeView("ph")}>PH time</button>
          <button type="button" className={timeView === "us" ? "active" : ""} onClick={() => setTimeView("us")}><ArrowLeftRight size={14} /> {timezoneLabel}</button>
        </div>
      </div>

      <section className="inbound-panel call-panel">
        <div className="inbound-panel-heading">
          <div className="inbound-panel-title"><span className="inbound-section-icon"><Clock3 size={17} /></span><div><p className="inbound-kicker">CALL ROTATION</p><h2>Inbound call schedule</h2></div></div>
          <span className="inbound-count-pill">{callAssignments.length} {callAssignments.length === 1 ? "person" : "people"}</span>
        </div>

        <div className="inbound-call-window-row">
          <span>Call window</span>
          <label><small>From</small><input type="time" value={callWindow.start} onChange={(event) => updateSchedule({ callWindow: { ...callWindow, start: event.target.value } })} aria-label="Inbound call window starts, Manila time" /></label>
          <span className="inbound-range-dash">to</span>
          <label><small>To</small><input type="time" value={callWindow.end} onChange={(event) => updateSchedule({ callWindow: { ...callWindow, end: event.target.value } })} aria-label="Inbound call window ends, Manila time" /></label>
          <span className="inbound-timezone-note">Manila time · {timeLabel(callWindow.start)}–{timeLabel(callWindow.end)}</span>
        </div>

        <div className="inbound-add-row">
          <Select value={newCallMemberId} onValueChange={setNewCallMemberId}>
            <SelectTrigger aria-label="Choose teammate for inbound call time" disabled={!availableCallMembers.length}><SelectValue placeholder="Choose teammate" /></SelectTrigger>
            <SelectContent>{availableCallMembers.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</SelectContent>
          </Select>
          <label><span>Start</span><input type="time" value={newCallStart} onChange={(event) => setNewCallStart(event.target.value)} aria-label="New inbound call start time, Manila time" /></label>
          <label><span>End</span><input type="time" value={newCallEnd} onChange={(event) => setNewCallEnd(event.target.value)} aria-label="New inbound call end time, Manila time" /></label>
          <Button type="button" onClick={addCallAssignment} disabled={!newCallMemberId || !newCallStart || !newCallEnd}><Plus size={15} /> Add call time</Button>
        </div>

        {callAssignments.length ? (
          <div className="inbound-call-list">
            <div className="inbound-timeline-axis">{timelineLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div>
            {callAssignments.map((assignment) => {
              const member = memberById.get(assignment.memberId);
              if (!member) return null;
              let startOffset = offsetFrom(callWindow.start, assignment.start);
              let endOffset = offsetFrom(callWindow.start, assignment.end);
              if (endOffset <= startOffset) endOffset += 1440;
              const visibleStart = Math.min(callWindowDuration, Math.max(0, startOffset));
              const visibleEnd = Math.min(callWindowDuration, Math.max(visibleStart, endOffset));
              const left = callWindowDuration ? visibleStart / callWindowDuration * 100 : 0;
              const width = callWindowDuration ? Math.max(0, (visibleEnd - visibleStart) / callWindowDuration * 100) : 0;
              const equivalent = convertedRange(assignment.start, assignment.end, previewDate, northAmericaZone);
              return (
                <article className="inbound-call-row" key={assignment.id}>
                  <div className="inbound-person-identity"><Avatar name={member.name} photo={member.photo} /><span className="inbound-call-person-edit"><Select value={member.id} onValueChange={(memberId) => changeCallAssignee(assignment.id, memberId)}><SelectTrigger className="inbound-call-member-trigger" aria-label={`Assigned teammate for ${member.name} call time`}><SelectValue /></SelectTrigger><SelectContent>{members.map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>)}</SelectContent></Select><small>{member.role}</small></span></div>
                  <div className="inbound-row-timing">
                    <label><span>Start · Manila</span><input type="time" value={assignment.start} onChange={(event) => updateCallAssignment(assignment.id, { start: event.target.value })} aria-label={`${member.name} inbound call start time, Manila time`} /></label>
                    <label><span>End · Manila</span><input type="time" value={assignment.end} onChange={(event) => updateCallAssignment(assignment.id, { end: event.target.value })} aria-label={`${member.name} inbound call end time, Manila time`} /></label>
                    <div className={`inbound-converted-time ${timeView === "us" ? "is-primary" : ""}`}><small>{timezoneLabel} · {durationLabel(assignment.start, assignment.end)}</small><strong>{equivalent}</strong></div>
                  </div>
                  <div className="inbound-lane"><span className="inbound-lane-base" /><span className="inbound-lane-fill" style={{ left: `${left}%`, width: `${width}%` }} /><span className="inbound-lane-label" style={{ left: `${left}%`, width: `${width}%` }}>{rangeLabel(assignment.start, assignment.end)}</span></div>
                  <Button type="button" variant="ghost" size="icon" className="inbound-remove-button" aria-label={`Remove ${member.name} inbound call time`} onClick={() => removeCallAssignment(assignment.id)}><Trash2 size={15} /></Button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="inbound-empty"><span><UsersRound size={19} /></span><strong>No call times yet</strong></div>
        )}
      </section>

    </section>
  );
}
