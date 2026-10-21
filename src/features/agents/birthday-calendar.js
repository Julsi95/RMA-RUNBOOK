const BIRTHDAY_REVEAL_DAYS = 14;

export function getNextBirthday(value, now = new Date()) {
  const [, month, day] = String(value ?? "").match(/^\d{4}-(\d{2})-(\d{2})$/) ?? [];
  if (!month || !day) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let date = new Date(now.getFullYear(), Number(month) - 1, Number(day));
  if (date < today) date = new Date(now.getFullYear() + 1, Number(month) - 1, Number(day));
  return { date, days: Math.round((date - today) / 86_400_000), month: date.getMonth() + 1 };
}

export function canShowBirthday({ birthday, isPublic, canManage, now = new Date() }) {
  const next = getNextBirthday(birthday, now);
  return Boolean(next && (canManage || isPublic || next.days <= BIRTHDAY_REVEAL_DAYS));
}

