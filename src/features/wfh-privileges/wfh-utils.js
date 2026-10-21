import { WFH_MAX_REQUEST_DAYS } from "./wfh-types.js";

export function isWorkingWeekday(dateValue, holidays = []) {
  if (!dateValue) return false;
  const [year, month, day] = String(dateValue).slice(0, 10).split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  return !holidays.some((holiday) => holiday.holiday_date === String(dateValue).slice(0, 10) && !holiday.is_working);
}

export function uniqueSortedDates(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).slice(0, 10)))].sort();
}

export function validateRequestedDates(dates, holidays = [], today = new Date()) {
  const uniqueDates = uniqueSortedDates(dates);
  if (!uniqueDates.length || uniqueDates.length > WFH_MAX_REQUEST_DAYS) return `Choose between 1 and ${WFH_MAX_REQUEST_DAYS} dates.`;
  const todayIso = today.toISOString().slice(0, 10);
  if (uniqueDates.some((date) => date <= todayIso)) return "Choose dates after today.";
  if (uniqueDates.some((date) => !isWorkingWeekday(date, holidays))) return "Choose weekdays marked as working days.";
  return "";
}

export function balanceForEmployee(rewards, employeeId, today = new Date()) {
  const todayIso = today.toISOString().slice(0, 10);
  return rewards.filter((reward) => reward.employee_id === employeeId && !reward.revoked_at && reward.expires_on >= todayIso)
    .reduce((total, reward) => total + reward.days_available, 0);
}


