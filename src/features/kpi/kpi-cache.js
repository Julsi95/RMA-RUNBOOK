import { loadKpiMonthDataForMonth, loadKpiMonthIndex, loadKpiMonthRevision, loadKpiScoringVersion } from "@/lib/backend-repositories";
import { fetchCachedQuery, queryClient, queryKeys, readCachedQuery } from "@/lib/backend/query-cache";
import { retryDataLoad } from "@/lib/backend/shared";

export function kpiIndexKey(userId) {
  return queryKeys.kpiMonthIndex(userId ?? "anonymous");
}

export function kpiMonthKey(userId, month) {
  return queryKeys.kpiMonth(userId ?? "anonymous", month);
}

export async function fetchKpiMonthIndex(userId, { force = false } = {}) {
  return fetchCachedQuery(kpiIndexKey(userId), () => retryDataLoad(loadKpiMonthIndex), { staleTime: Infinity, gcTime: Infinity, force });
}

export function readKpiMonth(userId, month) {
  return month ? readCachedQuery(kpiMonthKey(userId, month)) : undefined;
}

export async function fetchKpiMonth(userId, month, { checkRevision = false, forceContent = false } = {}) {
  if (!month) return null;
  const dataKey = kpiMonthKey(userId, month);
  const revisionKey = queryKeys.kpiMonthRevision(userId ?? "anonymous", month);
  const cached = readCachedQuery(dataKey);
  if (cached && !checkRevision && !forceContent) return cached;

  let revision = readCachedQuery(revisionKey);
  if (checkRevision || !cached || forceContent) {
    revision = await fetchCachedQuery(revisionKey, () => loadKpiMonthRevision(month), { staleTime: 0, gcTime: Infinity, force: true });
  }
  if (cached && !forceContent && cached.revision === revision) return cached;

  return fetchCachedQuery(dataKey, async () => {
    const indexedMonth = readCachedQuery(kpiIndexKey(userId))?.find((item) => item.month_key === month) ?? null;
    const data = await retryDataLoad(() => loadKpiMonthDataForMonth(month, indexedMonth));
    if (!data) return null;
    const scoring = data.scoringVersionId
      ? await fetchCachedQuery(queryKeys.kpiScoringVersion(data.scoringVersionId), () => retryDataLoad(() => loadKpiScoringVersion(data.scoringVersionId)), { staleTime: Infinity, gcTime: Infinity })
      : null;
    const scoringSettings = scoring?.settings ?? null;
    const records = Object.fromEntries(Object.entries(data.records).map(([id, record]) => [id, { ...record, scoringSettings }]));
    return { ...data, scoringSettings, records, revision };
  }, { staleTime: Infinity, gcTime: Infinity, force: true });
}

export function updateCachedKpiMonth(userId, month, data) {
  if (!month || !data) return data;
  queryClient.setQueryData(kpiMonthKey(userId, month), data);
  return data;
}

export function updateCachedKpiMonthIndex(userId, updater) {
  const key = kpiIndexKey(userId);
  queryClient.setQueryData(key, (current = []) => updater(current));
  return queryClient.getQueryData(key) ?? [];
}

export function invalidateKpiMonth(userId, month) {
  if (!month) return;
  void queryClient.invalidateQueries({ queryKey: kpiMonthKey(userId, month), exact: true, refetchType: "none" });
  void queryClient.invalidateQueries({ queryKey: queryKeys.kpiMonthRevision(userId ?? "anonymous", month), exact: true, refetchType: "none" });
}

export function invalidateKpiMonthIndex(userId) {
  return queryClient.invalidateQueries({ queryKey: kpiIndexKey(userId), exact: true, refetchType: "none" });
}
