export function getImportedKpiRank(record) {
  if (record?.source !== "import") return null;
  const rank = Number(String(record.metrics?._importedRank ?? "").trim().match(/\d+/)?.[0]);
  return Number.isFinite(rank) ? rank : null;
}

export function rankKpiRecords(records, getScore) {
  return Object.entries(records ?? {}).map(([id, record]) => ({
    id,
    record,
    explicitRank: getImportedKpiRank(record),
    score: getScore(record),
    name: record.memberName ?? "",
  })).sort((a, b) => {
    if (a.explicitRank != null && b.explicitRank != null && a.explicitRank !== b.explicitRank) return a.explicitRank - b.explicitRank;
    if (a.explicitRank != null && b.explicitRank == null) return -1;
    if (a.explicitRank == null && b.explicitRank != null) return 1;
    return b.score - a.score || a.name.localeCompare(b.name);
  });
}

export function getConsecutiveTopThreeStreak(history, memberId, throughMonth, getScore) {
  if (!/^\d{4}-\d{2}$/.test(throughMonth)) return 0;
  const [year, month] = throughMonth.split("-").map(Number);
  let streak = 0;

  for (let offset = 0; offset < 12; offset += 1) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const monthData = history[monthKey];
    const records = monthData?.records ?? monthData;
    if (!records?.[memberId]) break;

    const ranked = rankKpiRecords(records, (record) => getScore(record, monthData));
    const index = ranked.findIndex((entry) => entry.id === memberId);
    const rank = ranked[index]?.explicitRank ?? index + 1;
    if (rank < 1 || rank > 3) break;
    streak += 1;
  }

  return streak;
}
