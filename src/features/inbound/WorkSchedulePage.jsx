import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CalendarPlus, Check, Clock3, History, Plus, RotateCcw, Trash2, UsersRound, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { useOrganizationRoster } from "@/app/organization-provider";
import { getOperationalRoster } from "@/features/organization/organization-data";
import { useAuth } from "@/app/auth-provider";
import { isSupabaseConfigured } from "@/lib/supabase";
import { loadWorkScheduleDocument, saveWorkScheduleDocument } from "@/lib/backend-repositories";
import { retryDataLoad, subscribeToTables } from "@/lib/backend/shared";
import { fetchCachedQuery, queryClient, queryKeys, readCachedQuery } from "@/lib/backend/query-cache";
import "@/features/inbound/work-schedule.css";

const STORAGE_KEY = "starter-app-inbound-schedule-v1";
const PERIODS_STORAGE_KEY = "starter-app-work-schedule-periods-v1";
const HISTORY_STORAGE_KEY = "starter-app-work-schedule-history-v1";
const ZONES = [
  { id: "America/New_York", label: "Eastern · New York / Toronto" },
  { id: "America/Chicago", label: "Central · Chicago / Winnipeg" },
  { id: "America/Denver", label: "Mountain · Denver" },
  { id: "America/Phoenix", label: "Arizona · Phoenix" },
  { id: "America/Los_Angeles", label: "Pacific · Los Angeles / Vancouver" },
  { id: "America/Anchorage", label: "Alaska · Anchorage" },
  { id: "Pacific/Honolulu", label: "Hawaii · Honolulu" },
];
const PRESETS = {
  "9-6": { start: "21:00", end: "06:00" },
  "10-7": { start: "22:00", end: "07:00" },
};

function currentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function today() {
  const date = new Date();
  if (date.getDay() === 6) date.setDate(date.getDate() - 1);
  if (date.getDay() === 0) date.setDate(date.getDate() - 2);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isWeekday(value) {
  if (!value) return false;
  const weekday = new Date(`${value}T12:00:00`).getDay();
  return weekday >= 1 && weekday <= 5;
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `work-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readSchedules() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function readDatePeriods() {
  try {
    const storedPeriods = localStorage.getItem(PERIODS_STORAGE_KEY);
    if (storedPeriods) {
      const parsed = JSON.parse(storedPeriods);
      if (Array.isArray(parsed)) return parsed;
    }
    const legacySchedules = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return Object.values(legacySchedules).flatMap((schedule) => Object.entries(schedule?.workDateSchedules ?? {}).map(([date, override]) => ({
      id: `legacy-${date}`,
      startDate: date,
      endDate: date,
      workPreset: override.workPreset ?? "custom",
      workSchedules: override.workSchedules ?? [],
      updatedAt: "legacy",
    })));
  } catch {
    return [];
  }
}

function readScheduleHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function makeMonthSchedule(members) {
  return {
    callWindow: { start: "21:00", end: "06:00" },
    callAssignments: [],
    workPreset: "9-6",
    workSchedules: members.map((member) => ({ id: `work-${member.id}`, memberId: member.id, ...PRESETS["9-6"] })),
  };
}

function getPresetForSchedules(schedules) {
  const match = Object.entries(PRESETS).find(([, preset]) => schedules.every((schedule) => schedule.start === preset.start && schedule.end === preset.end));
  return match?.[0] ?? "custom";
}

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "?";
}

function timeLabel(value) {
  if (!/^\d{2}:\d{2}$/.test(value ?? "")) return "—";
  const [rawHour, minute] = value.split(":").map(Number);
  return `${rawHour % 12 || 12}:${String(minute).padStart(2, "0")} ${rawHour >= 12 ? "PM" : "AM"}`;
}

function timeMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(value ?? "")) return 0;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function plusOneDay(value) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function zonedParts(date, zone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function localTimeToInstant(dateString, timeString, zone) {
  const [year, month, day] = dateString.split("-").map(Number);
  const [hour, minute] = timeString.split(":").map(Number);
  const expected = Date.UTC(year, month - 1, day, hour, minute);
  let instant = expected;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(instant), zone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const correction = expected - represented;
    instant += correction;
    if (!correction) break;
  }
  return new Date(instant);
}

function convertedRange(start, end, date, zone) {
  if (!/^\d{2}:\d{2}$/.test(start ?? "") || !/^\d{2}:\d{2}$/.test(end ?? "")) return "Choose both times";
  const finishDate = timeMinutes(end) <= timeMinutes(start) ? plusOneDay(date) : date;
  const startInstant = localTimeToInstant(date, start, "Asia/Manila");
  const endInstant = localTimeToInstant(finishDate, end, "Asia/Manila");
  const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric" });
  const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const startDate = dateFmt.format(startInstant);
  const endDate = dateFmt.format(endInstant);
  return `${startDate} ${timeFmt.format(startInstant)} – ${startDate === endDate ? "" : `${endDate} `}${timeFmt.format(endInstant)}`;
}

function dateLabel(value) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function shiftDate(value, days) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftToWeekday(value, direction) {
  let next = value;
  while (!isWeekday(next)) next = shiftDate(next, direction);
  return next;
}

function daysInRange(startDate, endDate) {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  return Math.round((end - start) / 86400000) + 1;
}

function weekdaysInRange(startDate, endDate) {
  let count = 0;
  for (const date = new Date(`${startDate}T12:00:00`); date <= new Date(`${endDate}T12:00:00`); date.setDate(date.getDate() + 1)) {
    if (date.getDay() !== 0 && date.getDay() !== 6) count += 1;
  }
  return count;
}

function replaceRange(periods, startDate, endDate, replacement) {
  const remaining = periods.flatMap((period) => {
    if (period.endDate < startDate || period.startDate > endDate) return [period];
    const pieces = [];
    if (period.startDate < startDate) pieces.push({ ...period, id: newId(), endDate: shiftToWeekday(shiftDate(startDate, -1), -1) });
    if (period.endDate > endDate) pieces.push({ ...period, id: newId(), startDate: shiftToWeekday(shiftDate(endDate, 1), 1) });
    return pieces;
  });
  return [...remaining, replacement];
}

function removeDateFromRange(periods, periodId, date) {
  return periods.flatMap((period) => {
    if (period.id !== periodId) return [period];
    const pieces = [];
    if (period.startDate < date) pieces.push({ ...period, id: newId(), endDate: shiftToWeekday(shiftDate(date, -1), -1) });
    if (period.endDate > date) pieces.push({ ...period, id: newId(), startDate: shiftToWeekday(shiftDate(date, 1), 1) });
    return pieces;
  });
}

function Avatar({ member }) {
  return <span className="work-avatar">{member.photo ? <img src={member.photo} alt="" /> : initials(member.name)}</span>;
}

export default function WorkSchedulePage() {
  const { members: rosterMembers } = useOrganizationRoster();
  const members = useMemo(() => getOperationalRoster(rosterMembers), [rosterMembers]);
  const { canEdit, user } = useAuth();
  const resourceKey = useMemo(() => queryKeys.workSchedule(user?.id ?? "anonymous", canEdit), [canEdit, user?.id]);
  const cachedDocument = readCachedQuery(resourceKey);
  const [month, setMonth] = useState(currentMonth);
  const [selectedDate, setSelectedDate] = useState(today);
  const [savedSchedules, setSavedSchedules] = useState(() => isSupabaseConfigured ? cachedDocument?.months ?? {} : readSchedules());
  const [datePeriods, setDatePeriods] = useState(() => isSupabaseConfigured ? cachedDocument?.periods ?? [] : readDatePeriods());
  const [scheduleHistory, setScheduleHistory] = useState(() => isSupabaseConfigured ? cachedDocument?.history ?? [] : readScheduleHistory());
  const [remoteReady, setRemoteReady] = useState(Boolean(cachedDocument));
  const [syncError, setSyncError] = useState("");
  const remoteSnapshotRef = useRef(cachedDocument ? structuredClone(cachedDocument) : null);
  const [draftSchedules, setDraftSchedules] = useState([]);
  const [rangeStart, setRangeStart] = useState(today);
  const [rangeEnd, setRangeEnd] = useState(today);
  const [scheduleError, setScheduleError] = useState("");
  const [rangeBaseline, setRangeBaseline] = useState(() => ({ startDate: today(), endDate: today() }));
  const [isDirty, setIsDirty] = useState(false);
  const [zone, setZone] = useState("America/New_York");
  const [newMemberId, setNewMemberId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewEntry, setPreviewEntry] = useState(null);
  const [viewingHistoryEntry, setViewingHistoryEntry] = useState(null);
  const [editingHistoryEntry, setEditingHistoryEntry] = useState(null);
  const [saveMessage, setSaveMessage] = useState("");

  const toRemoteDocument = (months = savedSchedules, periods = datePeriods, history = scheduleHistory) => ({
    months: Object.fromEntries(Object.entries(months).map(([key, value]) => [key, { workPreset: value.workPreset ?? "custom", workSchedules: value.workSchedules ?? [] }])),
    periods: periods.map((period) => ({ ...period, workSchedules: period.workSchedules ?? [] })),
    history,
  });
  const canManage = canEdit && (!isSupabaseConfigured || Boolean(remoteSnapshotRef.current));

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const monthSchedule = savedSchedules[month] ?? makeMonthSchedule(members);
  const activePeriod = datePeriods.filter((period) => period.startDate <= selectedDate && period.endDate >= selectedDate).sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))[0] ?? null;
  const sourceSchedules = activePeriod?.workSchedules ?? monthSchedule.workSchedules ?? [];
  const scheduledIds = new Set((monthSchedule.workSchedules ?? []).map((schedule) => schedule.memberId));
  const draftMemberIds = new Set(draftSchedules.map((schedule) => schedule.memberId));
  const availableMembers = members.filter((member) => editingHistoryEntry
    ? !draftMemberIds.has(member.id)
    : !scheduledIds.has(member.id));
  const maxDate = `${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()).padStart(2, "0")}`;
  const zoneLabel = ZONES.find((item) => item.id === zone)?.label.split(" · ")[0] ?? "North America";
  const validRange = Boolean(rangeStart && rangeEnd && rangeStart <= rangeEnd && isWeekday(rangeStart) && isWeekday(rangeEnd));
  const rangeLength = validRange ? weekdaysInRange(rangeStart, rangeEnd) : 0;
  const rangeChanged = rangeStart !== rangeBaseline.startDate || rangeEnd !== rangeBaseline.endDate;
  const hasUnsavedChanges = isDirty || rangeChanged;
  const historyCardEntry = viewingHistoryEntry ?? editingHistoryEntry;
  const previewSpanLabel = validRange ? rangeStart === rangeEnd ? dateLabel(rangeStart) : `${dateLabel(rangeStart)} – ${dateLabel(rangeEnd)}` : "Choose a valid date range";

  useEffect(() => {
    if (!isSupabaseConfigured && !savedSchedules[month]) {
      setSavedSchedules((current) => ({ ...current, [month]: makeMonthSchedule(members) }));
    }
  }, [month, members, savedSchedules]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    void fetchCachedQuery(resourceKey, () => retryDataLoad(loadWorkScheduleDocument)).then((document) => {
      if (!active) return;
      const normalized = toRemoteDocument(document.months, document.periods, document.history);
      remoteSnapshotRef.current = structuredClone(normalized);
      setSavedSchedules(document.months);
      setDatePeriods(document.periods);
      setScheduleHistory(document.history);
      setRemoteReady(true);
      setSyncError("");
    }).catch((error) => { if (active) { setSyncError(error.message || "Could not load work schedules."); setRemoteReady(true); } });
    return () => { active = false; };
  }, [resourceKey]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    let timer;
    const unsubscribe = subscribeToTables(["work_schedule_months", "work_schedule_month_assignments", "work_schedule_periods", "work_schedule_period_assignments", "work_schedule_revisions"], () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void fetchCachedQuery(resourceKey, () => retryDataLoad(loadWorkScheduleDocument), { force: true }).then((document) => {
        if (!active) return;
        const normalized = toRemoteDocument(document.months, document.periods, document.history);
        remoteSnapshotRef.current = structuredClone(normalized);
        setSavedSchedules(document.months); setDatePeriods(document.periods); setScheduleHistory(document.history);
        if (!isDirty && !viewingHistoryEntry && !editingHistoryEntry) setDraftSchedules((document.periods.find((period) => period.startDate <= selectedDate && period.endDate >= selectedDate)?.workSchedules ?? document.months[month]?.workSchedules ?? []).map((schedule) => ({ ...schedule })));
        setSyncError("");
      }).catch((error) => { if (active) setSyncError(error.message || "Could not sync work schedules."); }); }, 180);
    }, "work-schedule");
    return () => { active = false; window.clearTimeout(timer); unsubscribe(); };
  }, [month, selectedDate, isDirty, viewingHistoryEntry, editingHistoryEntry, resourceKey]);

  useEffect(() => {
    if (isSupabaseConfigured) return undefined;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(savedSchedules)); } catch { /* session state still works */ }
  }, [savedSchedules]);

  useEffect(() => {
    if (isSupabaseConfigured) return undefined;
    try { localStorage.setItem(PERIODS_STORAGE_KEY, JSON.stringify(datePeriods)); } catch { /* session state still works */ }
  }, [datePeriods]);

  useEffect(() => {
    if (isSupabaseConfigured) return undefined;
    try { localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(scheduleHistory)); } catch { /* session state still works */ }
  }, [scheduleHistory]);

  useEffect(() => {
    if (!isSupabaseConfigured || !remoteReady || !canEdit || !remoteSnapshotRef.current) return undefined;
    const next = toRemoteDocument();
    if (JSON.stringify(next) === JSON.stringify(remoteSnapshotRef.current)) return undefined;
    const timeout = window.setTimeout(async () => {
      try {
        await saveWorkScheduleDocument(next);
        remoteSnapshotRef.current = next;
        queryClient.setQueryData(resourceKey, next);
        setSyncError("");
      } catch (error) { setSyncError(error.message || "Could not save work schedules."); }
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [savedSchedules, datePeriods, scheduleHistory, remoteReady, canEdit, resourceKey]);

  useEffect(() => {
    if (viewingHistoryEntry || editingHistoryEntry) return;
    setDraftSchedules(sourceSchedules.map((schedule) => ({ ...schedule })));
    setRangeStart(activePeriod?.startDate ?? selectedDate);
    setRangeEnd(activePeriod?.endDate ?? selectedDate);
    setRangeBaseline({ startDate: activePeriod?.startDate ?? selectedDate, endDate: activePeriod?.endDate ?? selectedDate });
    setIsDirty(false);
    setSaveMessage("");
  }, [month, selectedDate, viewingHistoryEntry, editingHistoryEntry]);

  useEffect(() => {
    if (!availableMembers.some((member) => member.id === newMemberId)) setNewMemberId(availableMembers[0]?.id ?? "");
  }, [availableMembers, newMemberId]);

  function changeMonth(nextMonth) {
    if (!nextMonth) return;
    setViewingHistoryEntry(null);
    setEditingHistoryEntry(null);
    setMonth(nextMonth);
    setSelectedDate(`${nextMonth}-01`);
  }

  function recordHistory(entry, replaceMatching = false) {
    const people = entry.people ?? entry.workSchedules.map((schedule) => {
      const member = memberById.get(schedule.memberId);
      return { memberId: schedule.memberId, name: member?.name ?? "Former team member", role: member?.role ?? "No longer on roster" };
    });
    const savedAt = new Date().toISOString();
    setScheduleHistory((current) => {
      const match = replaceMatching ? current.find((item) => item.scope === entry.scope && (entry.scope === "range"
        ? item.startDate === entry.startDate && item.endDate === entry.endDate
        : item.month === entry.month)) : null;
      const next = { ...entry, people, id: match?.id ?? newId(), savedAt };
      return [next, ...current.filter((item) => item.id !== match?.id)].slice(0, 100);
    });
  }

  function deleteHistory(entryId) {
    if (!canManage) return;
    setScheduleHistory((current) => current.filter((entry) => entry.id !== entryId));
    if (previewEntry?.id === entryId) setPreviewEntry(null);
    if (viewingHistoryEntry?.id === entryId) setViewingHistoryEntry(null);
    if (editingHistoryEntry?.id === entryId) setEditingHistoryEntry(null);
  }

  function patchDraft(id, patch) {
    if (!canManage) return;
    setDraftSchedules((current) => current.map((schedule) => schedule.id === id ? { ...schedule, ...patch } : schedule));
    setIsDirty(true);
    setSaveMessage("");
  }

  function applyPreset(presetId) {
    if (!canManage) return;
    if (presetId === "custom") {
      setIsDirty(true);
      setSaveMessage("");
      return;
    }
    setDraftSchedules((current) => current.map((schedule) => ({ ...schedule, ...PRESETS[presetId] })));
    setIsDirty(true);
    setSaveMessage("");
  }

  function saveDateRange() {
    if (!canManage) return;
    if (!validRange) { setScheduleError("Choose weekdays for both the start and end dates."); return; }
    if (new Set(draftSchedules.map((schedule) => schedule.memberId)).size !== draftSchedules.length) { setScheduleError("A person can only appear once in this schedule."); return; }
    setScheduleError("");
    const period = {
      id: newId(),
      startDate: rangeStart,
      endDate: rangeEnd,
      workPreset: getPresetForSchedules(draftSchedules),
      workSchedules: draftSchedules.map((schedule) => ({ ...schedule })),
      updatedAt: new Date().toISOString(),
    };
    setDatePeriods((current) => replaceRange(current, rangeStart, rangeEnd, period));
    recordHistory({ scope: "range", startDate: rangeStart, endDate: rangeEnd, workPreset: period.workPreset, workSchedules: period.workSchedules }, true);
    setRangeBaseline({ startDate: rangeStart, endDate: rangeEnd });
    setEditingHistoryEntry(null);
    setIsDirty(false);
    setSaveMessage(`Saved for ${rangeLength} ${rangeLength === 1 ? "day" : "days"}`);
  }

  function saveMonthDefault() {
    if (!canManage) return;
    if (new Set(draftSchedules.map((schedule) => schedule.memberId)).size !== draftSchedules.length) { setScheduleError("A person can only appear once in this schedule."); return; }
    setScheduleError("");
    const workSchedules = draftSchedules.map((schedule) => ({ ...schedule }));
    const workPreset = getPresetForSchedules(draftSchedules);
    setSavedSchedules((current) => {
      const base = current[month] ?? makeMonthSchedule(members);
      return { ...current, [month]: { ...base, workPreset, workSchedules } };
    });
    recordHistory({ scope: "month", month, workPreset, workSchedules }, true);
    setEditingHistoryEntry(null);
    setIsDirty(false);
    setSaveMessage(`Monthly default saved for ${new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(`${month}-01T12:00:00`))}`);
  }

  function resetDateOverride() {
    if (!canManage) return;
    if (!activePeriod) return;
    recordHistory({ scope: "range", startDate: activePeriod.startDate, endDate: activePeriod.endDate, workPreset: activePeriod.workPreset, workSchedules: activePeriod.workSchedules, action: "Before reset to monthly default" });
    setDatePeriods((current) => removeDateFromRange(current, activePeriod.id, selectedDate));
    setDraftSchedules((monthSchedule.workSchedules ?? []).map((schedule) => ({ ...schedule })));
    setRangeStart(selectedDate);
    setRangeEnd(selectedDate);
    setRangeBaseline({ startDate: selectedDate, endDate: selectedDate });
    setIsDirty(false);
    setSaveMessage("This date now uses the monthly default");
  }

  function addExistingMember() {
    if (!canManage) return;
    const member = memberById.get(newMemberId);
    if (!member) return;
    const preset = PRESETS[editingHistoryEntry?.workPreset] ?? PRESETS[monthSchedule.workPreset] ?? PRESETS["9-6"];
    const schedule = { id: newId(), memberId: member.id, ...preset };
    if (editingHistoryEntry) {
      setDraftSchedules((current) => [...current, schedule]);
      setIsDirty(true);
      setSaveMessage("Unsaved edit · save to apply");
      return;
    }
    setSavedSchedules((current) => {
      const base = current[month] ?? makeMonthSchedule(members);
      return { ...current, [month]: { ...base, workSchedules: [...(base.workSchedules ?? []), schedule] } };
    });
    const nextMonthSchedules = [...(monthSchedule.workSchedules ?? []), schedule];
    recordHistory({ scope: "month", month, workPreset: getPresetForSchedules(nextMonthSchedules), workSchedules: nextMonthSchedules, action: "Added roster member" }, true);
    if (activePeriod) {
      const nextPeriodSchedules = [...activePeriod.workSchedules, schedule];
      setDatePeriods((current) => current.map((period) => period.id === activePeriod.id ? { ...period, workSchedules: nextPeriodSchedules } : period));
      recordHistory({ scope: "range", startDate: activePeriod.startDate, endDate: activePeriod.endDate, workPreset: getPresetForSchedules(nextPeriodSchedules), workSchedules: nextPeriodSchedules, action: "Added roster member" }, true);
    }
    setDraftSchedules((current) => [...current, schedule]);
    setIsDirty(false);
  }

  function restoreHistory(entry) {
    const workSchedules = entry.workSchedules.map((schedule) => ({ ...schedule }));
    if (entry.scope === "range") {
      const rangeMonth = entry.startDate.slice(0, 7);
      setMonth(rangeMonth);
      setSelectedDate(entry.startDate);
      setRangeStart(entry.startDate);
      setRangeEnd(entry.endDate);
      setRangeBaseline({ startDate: entry.startDate, endDate: entry.endDate });
    } else {
      setMonth(entry.month);
      const viewDate = `${entry.month}-01`;
      setSelectedDate(viewDate);
      setRangeStart(viewDate);
      setRangeEnd(viewDate);
      setRangeBaseline({ startDate: viewDate, endDate: viewDate });
    }
    setEditingHistoryEntry(null);
    setViewingHistoryEntry(entry);
    setDraftSchedules(workSchedules);
    setIsDirty(false);
    setSaveMessage("Viewing saved version · active schedule unchanged");
  }

  function editHistory(entry) {
    if (!canManage) return;
    const workSchedules = entry.workSchedules.map((schedule) => ({ ...schedule }));
    if (entry.scope === "range") {
      setMonth(entry.startDate.slice(0, 7));
      setSelectedDate(entry.startDate);
      setRangeStart(entry.startDate);
      setRangeEnd(entry.endDate);
      setRangeBaseline({ startDate: entry.startDate, endDate: entry.endDate });
    } else {
      const monthDate = `${entry.month}-01`;
      setMonth(entry.month);
      setSelectedDate(monthDate);
      setRangeStart(monthDate);
      setRangeEnd(monthDate);
      setRangeBaseline({ startDate: monthDate, endDate: monthDate });
    }
    setViewingHistoryEntry(null);
    setEditingHistoryEntry(entry);
    setDraftSchedules(workSchedules);
    setIsDirty(true);
    setSaveMessage("Editing saved version · save to apply");
  }

  function returnToActiveSchedule() {
    setViewingHistoryEntry(null);
    setEditingHistoryEntry(null);
    setSaveMessage("");
  }

  function discardHistoryEdits() {
    setEditingHistoryEntry(null);
    setSaveMessage("");
  }

  function historyScopeLabel(entry) {
    return entry.scope === "range"
      ? `${dateLabel(entry.startDate)} – ${dateLabel(entry.endDate)}`
      : `${new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(`${entry.month}-01T12:00:00`))} · monthly default`;
  }

  function removeFromDraft(id) {
    if (!canManage) return;
    setDraftSchedules((current) => current.filter((schedule) => schedule.id !== id));
    setIsDirty(true);
    setSaveMessage("");
  }

  return (
    <section className="page-content work-schedule-page">
      <div className="page-heading work-page-heading">
        <div><p className="eyebrow">OPERATIONS</p><h1>Work schedule</h1><p>Set monthly hours and save adjustments for a day or date range.</p></div>
        <div className="work-heading-actions"><span className="work-live-status"><i />{isSupabaseConfigured ? syncError ? "Sync issue" : remoteReady ? canManage ? "Shared schedule" : "Published schedule" : "Loading schedules…" : "Saved in this browser"}</span><Button variant="outline" onClick={() => setHistoryOpen((open) => !open)}><History size={16} /> {historyOpen ? "Hide history" : `History${scheduleHistory.length ? ` · ${scheduleHistory.length}` : ""}`}</Button></div>
      </div>
      {syncError && <p className="auth-error" role="alert">{syncError}</p>}

      <section className="work-control-panel">
        <label className="work-date-control"><span><CalendarDays size={15} /> Schedule month</span><input type="month" value={month} disabled={Boolean(historyCardEntry)} onChange={(event) => changeMonth(event.target.value)} aria-label="Work schedule month" /></label>
        <label className="work-date-control"><span><CalendarPlus size={15} /> Specific weekday</span><input type="date" value={selectedDate} min={`${month}-01`} max={maxDate} disabled={Boolean(historyCardEntry)} onChange={(event) => { const value = event.target.value; if (!isWeekday(value)) { setScheduleError("Work schedules are available Monday through Friday."); return; } setScheduleError(""); setViewingHistoryEntry(null); setEditingHistoryEntry(null); setSelectedDate(value); }} aria-label="Specific work schedule weekday" /></label>
        <label className="work-zone-control"><span>Time zone preview</span><Select value={zone} onValueChange={setZone}><SelectTrigger aria-label="North American timezone"><SelectValue /></SelectTrigger><SelectContent>{ZONES.map((item) => <SelectItem value={item.id} key={item.id}>{item.label}</SelectItem>)}</SelectContent></Select></label>
        <div className="work-date-summary"><span>{dateLabel(selectedDate)}</span><strong>{viewingHistoryEntry ? "Viewing saved version" : editingHistoryEntry ? "Editing saved version" : activePeriod ? `Special schedule · ${dateLabel(activePeriod.startDate)} to ${dateLabel(activePeriod.endDate)}` : "Using monthly default"}</strong></div>
      </section>

      <section className="work-period-picker" aria-label="Schedule date range">
        <div className="work-period-copy"><span className="work-section-icon"><CalendarPlus size={17} /></span><div><strong>Apply schedule to a date span</strong><span>Cards show the selected date; saving applies them to every date in this range.</span></div></div>
        <label><span>From · weekday</span><input type="date" value={rangeStart} disabled={Boolean(historyCardEntry)} onChange={(event) => { if (!isWeekday(event.target.value)) { setScheduleError("Choose a Monday–Friday start date."); return; } setScheduleError(""); setRangeStart(event.target.value); setSaveMessage(""); }} aria-label="Schedule range starts on a weekday" /></label>
        <span className="work-period-to">through</span>
        <label><span>Through · weekday</span><input type="date" value={rangeEnd} disabled={Boolean(historyCardEntry)} onChange={(event) => { if (!isWeekday(event.target.value)) { setScheduleError("Choose a Monday–Friday end date."); return; } setScheduleError(""); setRangeEnd(event.target.value); setSaveMessage(""); }} aria-label="Schedule range ends on a weekday" /></label>
        <div className={`work-period-length ${validRange ? "" : "invalid"}`}>{validRange ? `${rangeLength} ${rangeLength === 1 ? "weekday" : "weekdays"}` : "Choose weekdays in date order"}</div>
      </section>

      <section className="work-schedule-panel">
        {scheduleError && <p className="auth-error" role="alert">{scheduleError}</p>}
        {viewingHistoryEntry && <div className="work-history-view-banner"><div><History size={16} /><span>Read-only saved version · edit it to make changes, or return to the active schedule.</span></div><div className="work-history-banner-actions">{canManage && <Button variant="outline" onClick={() => editHistory(viewingHistoryEntry)}>Edit this schedule</Button>}<Button variant="ghost" onClick={returnToActiveSchedule}>Back to active schedule</Button></div></div>}
        {editingHistoryEntry && <div className="work-history-view-banner work-history-edit-banner"><div><History size={16} /><span>Editing saved version · changes apply to this saved month or date range when saved.</span></div><div className="work-history-banner-actions"><Button variant="outline" onClick={discardHistoryEdits}>Discard edits</Button><Button variant="ghost" onClick={returnToActiveSchedule}>Back to active schedule</Button></div></div>}
        <div className="work-section-heading">
          <div className="work-section-title"><span className="work-section-icon"><Clock3 size={18} /></span><div><p className="work-section-kicker">{viewingHistoryEntry ? "HISTORY VIEW" : editingHistoryEntry ? "EDITING SAVED VERSION" : activePeriod ? "SAVED DATE RANGE" : "MONTHLY DEFAULT"}</p><h2>{historyCardEntry ? historyScopeLabel(historyCardEntry) : activePeriod ? `Schedule active on ${dateLabel(selectedDate)}` : "Team work hours"}</h2><p>{viewingHistoryEntry ? `Saved ${new Date(viewingHistoryEntry.savedAt).toLocaleString()}. The active schedule is unchanged.` : editingHistoryEntry ? "Adjust the cards, then save to update this saved schedule." : activePeriod ? `This saved schedule covers ${dateLabel(activePeriod.startDate)} through ${dateLabel(activePeriod.endDate)}.` : "This schedule is shown for dates without a saved range."}</p></div></div>
          <div className="work-section-state"><span className={hasUnsavedChanges ? "work-unsaved-dot" : "work-saved-dot"} />{viewingHistoryEntry ? "Read-only version" : editingHistoryEntry ? "Editing saved version" : hasUnsavedChanges ? "Unsaved changes" : saveMessage || "All changes saved"}</div>
        </div>

        <div className="work-tools-row">
          <div className="work-preset-group" role="group" aria-label="Apply work hours to the current draft">
            <button type="button" disabled={!canManage || Boolean(viewingHistoryEntry)} className={getPresetForSchedules(draftSchedules) === "9-6" ? "active" : ""} onClick={() => applyPreset("9-6")}>9 PM – 6 AM</button>
            <button type="button" disabled={!canManage || Boolean(viewingHistoryEntry)} className={getPresetForSchedules(draftSchedules) === "10-7" ? "active" : ""} onClick={() => applyPreset("10-7")}>10 PM – 7 AM</button>
            <button type="button" disabled={!canManage || Boolean(viewingHistoryEntry)} className={`work-custom-button ${getPresetForSchedules(draftSchedules) === "custom" ? "active" : ""}`} onClick={() => applyPreset("custom")}>Custom hours</button>
          </div>
          <div className="work-save-actions">
            {canManage && (!editingHistoryEntry || editingHistoryEntry.scope === "month") && <Button variant="outline" onClick={saveMonthDefault} disabled={Boolean(viewingHistoryEntry) || !isDirty}><Check size={15} /> {editingHistoryEntry ? "Update monthly default" : "Save as monthly default"}</Button>}
            {canManage && (!editingHistoryEntry || editingHistoryEntry.scope === "range") && <Button onClick={saveDateRange} disabled={Boolean(viewingHistoryEntry) || (!isDirty && !rangeChanged) || !validRange}><CalendarPlus size={15} /> {editingHistoryEntry ? "Update saved date range" : <>Save for {rangeLength || "date span"} {rangeLength === 1 ? "day" : "days"}</>}</Button>}
            {canManage && activePeriod && !historyCardEntry && <Button variant="ghost" onClick={resetDateOverride}><RotateCcw size={15} /> Use default on this date</Button>}
          </div>
        </div>

        <div className="work-roster-tools">
          <div className="work-roster-overview"><div className="work-roster-count"><UsersRound size={16} /><span>{draftSchedules.length} {draftSchedules.length === 1 ? "person" : "people"} scheduled</span></div><div className="work-roster-preview-date"><CalendarDays size={15} /><span>{historyCardEntry ? "Saved schedule dates" : "Previewing schedule"}</span><strong>{historyCardEntry ? historyScopeLabel(historyCardEntry) : previewSpanLabel}</strong></div></div>
          {canManage && <div className="work-add-existing"><Select value={newMemberId} onValueChange={setNewMemberId}><SelectTrigger aria-label="Select roster employee to add to the current schedule" disabled={!availableMembers.length || Boolean(viewingHistoryEntry)}><SelectValue placeholder="Choose from roster" /></SelectTrigger><SelectContent>{availableMembers.map((member) => <SelectItem value={member.id} key={member.id}>{member.name} · {member.role}</SelectItem>)}</SelectContent></Select><Button variant="outline" onClick={addExistingMember} disabled={!newMemberId || Boolean(viewingHistoryEntry)}><Plus size={15} /> Add to schedule</Button></div>}
        </div>

        <div className="work-employee-grid">
          {draftSchedules.map((schedule) => {
            const member = memberById.get(schedule.memberId);
            const savedPerson = historyCardEntry?.people?.find((person) => person.memberId === schedule.memberId);
            if (!member && !savedPerson) return null;
            const displayMember = savedPerson ? { ...(member ?? {}), ...savedPerson, photo: "" } : member;
            const cardDate = historyCardEntry?.scope === "range" ? historyCardEntry.startDate : historyCardEntry?.scope === "month" ? `${historyCardEntry.month}-01` : selectedDate;
            return <article className="work-employee-card" key={schedule.id}>
              <div className="work-employee-card-head"><div className="work-employee-identity"><Avatar member={displayMember} /><span><strong>{displayMember.name}</strong><small>{displayMember.role}</small></span></div>{canManage && <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${displayMember.name} from this schedule`} title="Remove from this schedule" disabled={Boolean(viewingHistoryEntry)} onClick={() => removeFromDraft(schedule.id)}><Trash2 size={16} /></Button>}</div>
                <div className="work-time-fields"><label><span>Log in · Manila</span><input type="time" value={schedule.start} disabled={!canManage || Boolean(viewingHistoryEntry)} onChange={(event) => patchDraft(schedule.id, { start: event.target.value })} /></label><label><span>Log out · Manila</span><input type="time" value={schedule.end} disabled={!canManage || Boolean(viewingHistoryEntry)} onChange={(event) => patchDraft(schedule.id, { end: event.target.value })} /></label></div>
              <div className="work-time-conversion"><span>{zoneLabel} preview · {cardDate}</span><strong>{convertedRange(schedule.start, schedule.end, cardDate, zone)}</strong></div>
            </article>;
          })}
          {!draftSchedules.length && <div className="work-empty-state"><UsersRound size={22} /><strong>No one is scheduled</strong><span>Add a roster member or employee to begin.</span></div>}
        </div>
      </section>

      {historyOpen && <section className="work-history-panel">
        <div className="work-history-heading"><div><p className="work-section-kicker">SAVED VERSIONS</p><h2>Schedule history</h2><p>Saved monthly defaults and date ranges, newest first.</p></div><span>{scheduleHistory.length} versions</span></div>
        {scheduleHistory.length ? <div className="work-history-list">{scheduleHistory.map((entry) => <article className="work-history-item" key={entry.id}>
          <div className="work-history-icon"><History size={16} /></div><div className="work-history-info"><strong>{historyScopeLabel(entry)}</strong><span>{entry.workSchedules.length} {entry.workSchedules.length === 1 ? "person" : "people"} · {new Date(entry.savedAt).toLocaleString()}{entry.action ? ` · ${entry.action}` : ""}</span></div><div className="work-history-actions"><Button variant="outline" onClick={() => setPreviewEntry(entry)}>Preview</Button>{canManage && <Button variant="outline" onClick={() => editHistory(entry)}>Edit</Button>}<Button variant="outline" onClick={() => restoreHistory(entry)}><RotateCcw size={14} /> Restore</Button>{canManage && <Button type="button" variant="ghost" size="icon" className="work-history-delete" aria-label={`Delete history for ${historyScopeLabel(entry)}`} title="Delete history entry" onClick={() => deleteHistory(entry.id)}><Trash2 size={15} /></Button>}</div>
        </article>)}</div> : <div className="work-history-empty"><History size={20} /><strong>No saved versions yet</strong><span>Save a monthly default or date range and it will appear here.</span></div>}
      </section>}
      {previewEntry && <div className="work-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewEntry(null); }}><section className="work-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="work-preview-title">
        <div className="work-preview-heading"><div><p className="work-section-kicker">READ-ONLY PREVIEW</p><h2 id="work-preview-title">{historyScopeLabel(previewEntry)}</h2><p>Saved {new Date(previewEntry.savedAt).toLocaleString()}{previewEntry.action ? ` · ${previewEntry.action}` : ""}</p></div><Button type="button" variant="ghost" size="icon" aria-label="Close schedule preview" onClick={() => setPreviewEntry(null)}><X size={17} /></Button></div>
        <div className="work-preview-list">{previewEntry.workSchedules.map((schedule) => {
          const savedPerson = previewEntry.people?.find((person) => person.memberId === schedule.memberId);
          const currentPerson = memberById.get(schedule.memberId);
          const name = savedPerson?.name ?? currentPerson?.name ?? "Former team member";
          const role = savedPerson?.role ?? currentPerson?.role ?? "No longer on roster";
          return <article className="work-preview-person" key={`${schedule.id}-${schedule.memberId}`}><span className="work-avatar">{initials(name)}</span><div><strong>{name}</strong><small>{role}</small></div><span className="work-preview-hours">{timeLabel(schedule.start)} – {timeLabel(schedule.end)}</span></article>;
        })}{!previewEntry.workSchedules.length && <div className="work-preview-empty">No people were scheduled in this version.</div>}</div>
        <div className="work-preview-footer"><span>This preview won’t change the active schedule.</span><Button variant="outline" onClick={() => setPreviewEntry(null)}>Close</Button></div>
      </section></div>}
    </section>
  );
}
