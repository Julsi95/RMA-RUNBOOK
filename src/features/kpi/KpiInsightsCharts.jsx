import { useEffect, useMemo, useState } from "react";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { getMonthLabel, KPI_METRICS } from "@/features/kpi/kpi-data";
import { buildKpiPersonGroups } from "@/features/kpi/kpi-person-groups";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";

const MATRIX_PAGE_SIZE = 15;

function PointTooltip({ active, payload }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return <div className="chart-tooltip-content kpi-point-tooltip"><p>{point.name}{point.historical ? " · former roster" : ""}</p><div><span>Calls handled</span><strong>{point.calls}</strong></div><div><span>QA score</span><strong>{Number(point.qa).toFixed(2)}%</strong></div></div>;
}

export default function KpiInsightsCharts({ monthlyData, selectedMonth, people, getRecordScore, settingsOf }) {
  const [historyYear, setHistoryYear] = useState(selectedMonth.slice(0, 4));
  const [personSearch, setPersonSearch] = useState("");
  const [peoplePage, setPeoplePage] = useState(0);
  const records = monthlyData[selectedMonth]?.records ?? {};
  const selectedRows = useMemo(() => buildKpiPersonGroups([selectedMonth], monthlyData, people).map((person) => ({
    id: person.id, person, record: person.recordsByMonth[selectedMonth],
  })), [selectedMonth, monthlyData, people]);
  const attendance = ["absenteeism", "punctuality", "excessiveBreak"].map((id) => {
    const metric = KPI_METRICS.find((item) => item.id === id);
    const values = selectedRows.map(({ record }) => Number(record.metrics?.[id]?.rawValue)).filter((value) => Number.isFinite(value));
    return { name: metric.shortLabel, value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0, count: values.length };
  });
  const scatterRows = selectedRows.map(({ person, record }) => ({
    name: person.name,
    historical: person.historical,
    calls: Number(record.metrics?.callsHandled?.rawValue),
    qa: Number(record.metrics?.qa?.rawValue),
  })).filter((row) => Number.isFinite(row.calls) && Number.isFinite(row.qa));
  const availableHistoryMonths = useMemo(() => Object.keys(monthlyData)
    .filter((month) => month <= selectedMonth && Object.keys(monthlyData[month]?.records ?? {}).length)
    .sort(), [monthlyData, selectedMonth]);
  const availableYears = useMemo(() => [...new Set(availableHistoryMonths.map((month) => month.slice(0, 4)))].sort().reverse(), [availableHistoryMonths]);
  useEffect(() => {
    setHistoryYear(selectedMonth.slice(0, 4));
    setPeoplePage(0);
  }, [selectedMonth]);
  const activeHistoryYear = availableYears.includes(historyYear) ? historyYear : availableYears[0] ?? selectedMonth.slice(0, 4);
  const historyMonths = availableHistoryMonths.filter((month) => month.startsWith(`${activeHistoryYear}-`));
  const historyGroups = useMemo(() => buildKpiPersonGroups(historyMonths, monthlyData, people), [historyMonths, monthlyData, people]);
  const historyPeople = useMemo(() => historyGroups
    .filter((person) => `${person.name} ${person.role}`.toLowerCase().includes(personSearch.trim().toLowerCase()))
    .sort((a, b) => Number(Boolean(a.historical)) - Number(Boolean(b.historical)) || a.name.localeCompare(b.name)),
  [historyGroups, personSearch]);
  const pageCount = Math.ceil(historyPeople.length / MATRIX_PAGE_SIZE);
  const pagePeople = historyPeople.slice(peoplePage * MATRIX_PAGE_SIZE, (peoplePage + 1) * MATRIX_PAGE_SIZE);
  const firstVisiblePerson = historyPeople.length ? peoplePage * MATRIX_PAGE_SIZE + 1 : 0;
  const lastVisiblePerson = Math.min((peoplePage + 1) * MATRIX_PAGE_SIZE, historyPeople.length);
  useEffect(() => {
    setPeoplePage((page) => Math.min(page, Math.max(pageCount - 1, 0)));
  }, [pageCount]);
  const scores = historyGroups.flatMap((person) => Object.values(person.recordsByMonth).map((record) => getRecordScore(record, settingsOf(record))));
  const scoreMin = scores.length ? Math.min(...scores) : 0;
  const scoreRange = Math.max(0.01, (scores.length ? Math.max(...scores) : 0) - scoreMin);

  return <section className="kpi-insights-grid" aria-label="Monthly KPI insights">
    <article className="kpi-insight-card">
      <div className="kpi-insight-heading"><div><p className="kpi-overline">ATTENDANCE</p><h3>Average reported counts</h3></div><span>{selectedRows.length} people</span></div>
      {selectedRows.length ? <ChartContainer config={{ value: { label: "Average count", color: "var(--foreground)" } }} className="kpi-insight-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={attendance} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}><CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" /><XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} /><Tooltip content={<ChartTooltipContent valueFormatter={(value) => Number(value).toFixed(2)} />} /><Bar dataKey="value" name="Average reported count" fill="var(--color-value)" radius={[5, 5, 0, 0]} maxBarSize={42} /></BarChart></ResponsiveContainer></ChartContainer> : <div className="kpi-chart-empty">No attendance values for this month.</div>}
      <p className="kpi-insight-caption">Averages use the spreadsheet's raw counts for the selected month.</p>
    </article>

    <article className="kpi-insight-card">
      <div className="kpi-insight-heading"><div><p className="kpi-overline">QUALITY &amp; VOLUME</p><h3>Calls handled vs QA</h3></div><span>{scatterRows.length} plotted</span></div>
      {scatterRows.length ? <ChartContainer config={{ people: { label: "People", color: "var(--foreground)" } }} className="kpi-insight-chart"><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: -10 }}><CartesianGrid stroke="var(--border)" strokeDasharray="3 5" /><XAxis type="number" dataKey="calls" name="Calls handled" tickLine={false} axisLine={false} tickMargin={8} /><YAxis type="number" dataKey="qa" name="QA score" unit="%" domain={["dataMin - 1", "dataMax + 1"]} tickLine={false} axisLine={false} width={42} /><Tooltip content={<PointTooltip />} /><Scatter data={scatterRows} fill="var(--color-people)" fillOpacity={0.78} /></ScatterChart></ResponsiveContainer></ChartContainer> : <div className="kpi-chart-empty">Add calls and QA values to compare them.</div>}
      <p className="kpi-insight-caption">Each point is a saved monthly row. The chart shows association, not cause.</p>
    </article>

    <article className="kpi-insight-card kpi-insight-wide">
      <div className="kpi-insight-heading kpi-heatmap-heading"><div><p className="kpi-overline">HISTORICAL RECORDS</p><h3>Monthly score matrix</h3></div><div className="kpi-heatmap-controls"><label className="kpi-heatmap-year"><span>Year</span><select value={activeHistoryYear} onChange={(event) => { setHistoryYear(event.target.value); setPeoplePage(0); }} aria-label="Filter score matrix by year">{availableYears.map((year) => <option value={year} key={year}>{year}</option>)}</select></label><label className="kpi-heatmap-search"><span>Person</span><input type="search" value={personSearch} onChange={(event) => { setPersonSearch(event.target.value); setPeoplePage(0); }} placeholder="Find a person" aria-label="Search score matrix people" /></label><span className="kpi-heatmap-month-count">{historyMonths.length} {historyMonths.length === 1 ? "month" : "months"}</span></div></div>
      {historyPeople.length && historyMonths.length ? <div className="kpi-heatmap-scroll" role="region" aria-label={`Monthly score matrix for ${activeHistoryYear}`} tabIndex={0}><table className="kpi-heatmap"><thead><tr><th scope="col">Person</th>{historyMonths.map((month) => <th scope="col" key={month}>{getMonthLabel(month)}</th>)}</tr></thead><tbody>{pagePeople.map((person) => <tr key={person.id}><th scope="row"><span>{person.name}</span>{person.historical && <small>Former roster</small>}</th>{historyMonths.map((month) => {
        const record = person.recordsByMonth[month];
        if (!record) return <td key={month}><span className="kpi-heatmap-empty">—</span></td>;
        const score = getRecordScore(record, settingsOf(record));
        const intensity = Math.max(8, Math.min(32, 9 + ((score - scoreMin) / scoreRange) * 22));
        return <td key={month} title={`${getMonthLabel(month)} · ${score.toFixed(2)}${record.metrics?._importedRank ? ` · rank ${record.metrics._importedRank}` : ""}`}><span className="kpi-heatmap-cell" style={{ "--score-intensity": `${intensity}%` }}>{score.toFixed(2)}{record.metrics?._importedRank && <small>#{record.metrics._importedRank}</small>}</span></td>;
      })}</tr>)}</tbody></table></div> : <div className="kpi-chart-empty">{personSearch ? "No people match this search for the selected year." : `Saved monthly results for ${activeHistoryYear} will appear here, including former roster members.`}</div>}
      <div className="kpi-heatmap-pagination"><span>{historyPeople.length ? `People ${firstVisiblePerson}–${lastVisiblePerson} of ${historyPeople.length}` : "No people to show"}</span><div><button type="button" onClick={() => setPeoplePage((page) => Math.max(0, page - 1))} disabled={peoplePage === 0} aria-label="Previous score matrix people">Previous</button><span>{pageCount ? `${peoplePage + 1} / ${pageCount}` : "0 / 0"}</span><button type="button" onClick={() => setPeoplePage((page) => Math.min(pageCount - 1, page + 1))} disabled={peoplePage >= pageCount - 1} aria-label="Next score matrix people">Next</button></div></div>
      <p className="kpi-insight-caption">Browse saved scores and imported ranks by year. Former roster records remain available.</p>
    </article>
  </section>;
}
