import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { getKpiScoringSettings, getMaximumKpiScore, KPI_METRICS } from "@/features/kpi/kpi-data";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function formatScore(value) {
  return Number(value || 0).toFixed(2);
}

function importedRank(record) {
  const label = String(record?.metrics?._importedRank ?? "").trim();
  const rank = Number(label.match(/\d+/)?.[0]);
  return Number.isFinite(rank) ? rank : null;
}

export default function KpiTrendChart({ months, monthlyData, metricMode, range, targetId, selectedMonth, getRecordScore, settingsOf }) {
  const chartMonths = months.filter((month) => month <= selectedMonth).slice(-range);
  const metric = KPI_METRICS.find((item) => item.id === metricMode);
  const values = chartMonths.map((month) => {
    const records = monthlyData[month]?.records ?? {};
    const rows = targetId === "team" ? Object.values(records) : [records[targetId]].filter(Boolean);
    const numbers = rows.map((record) => {
      if (metricMode === "overall") return getRecordScore(record, settingsOf(record));
      if (metricMode === "rank") return importedRank(record);
      const value = record.metrics?.[metricMode]?.rawValue;
      return value === "" || value == null ? null : Number(value);
    }).filter((value) => value != null && Number.isFinite(value));
    return {
      month,
      label: new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit" }).format(new Date(`${month}-15T12:00:00`)),
      value: numbers.length ? numbers.reduce((sum, number) => sum + number, 0) / numbers.length : null,
    };
  }).filter((item) => item.value != null);
  const isRank = metricMode === "rank";
  const isPercent = metric?.isPercent;
  const isKpi = metricMode === "overall";
  const label = isRank ? "Imported rank" : isKpi ? "KPI score" : metric?.label ?? "Metric";
  const selectedSettings = monthlyData[selectedMonth]?.scoringSettings ?? getKpiScoringSettings();
  const max = isKpi ? Math.max(getMaximumKpiScore(selectedSettings), ...chartMonths.map((month) => getMaximumKpiScore(monthlyData[month]?.scoringSettings ?? selectedSettings)), 0.1) : 100;
  const target = isPercent ? 98 : isKpi ? Number([...selectedSettings.evaluationBands].sort((a, b) => Number(b.min) - Number(a.min))[0]?.min ?? max) : null;
  const observedMin = values.length ? Math.min(...values.map((item) => item.value)) : 0;
  const observedMax = values.length ? Math.max(...values.map((item) => item.value)) : max;
  const domainMin = isRank ? 1 : isPercent ? Math.min(90, Math.floor(observedMin - 1)) : 0;
  const domainMax = isRank ? Math.max(2, Math.ceil(observedMax)) : isPercent ? Math.max(100, Math.ceil(observedMax + 1)) : isKpi ? Math.max(max, Math.ceil(observedMax)) : Math.max(1, Math.ceil(observedMax * 1.1));
  const lastValue = values.at(-1)?.value;
  const priorValue = values.at(-2)?.value;
  const delta = lastValue == null || priorValue == null ? null : lastValue - priorValue;

  return <>
    {values.length ? <ChartContainer config={{ score: { label, color: "var(--foreground)" } }} className="kpi-trend-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={values} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={9} minTickGap={22} interval="preserveStartEnd" />
          <YAxis domain={[domainMin, domainMax]} reversed={isRank} tickLine={false} axisLine={false} tickMargin={8} width={48} tickFormatter={(value) => isRank ? `#${value}` : isPercent ? `${value}%` : Number(value).toFixed(isKpi ? 1 : 0)} />
          <Tooltip content={<ChartTooltipContent valueFormatter={(value) => isRank ? `#${Math.round(value)}` : isPercent ? `${Number(value).toFixed(2)}%` : formatScore(value)} />} />
          {target != null && <ReferenceLine y={Math.min(domainMax, Math.max(domainMin, target))} stroke="var(--muted-foreground)" strokeDasharray="5 5" />}
          <Line type="monotone" dataKey="value" name={label} stroke="var(--color-score)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--surface)", strokeWidth: 2 }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer> : <div className="kpi-chart-empty">{isRank ? "Imported rank history is not available in this range." : "No saved results in this range yet."}</div>}
    <div className="kpi-trend-footer"><span>{target == null ? (isRank ? "Imported rank · lower is better" : `Imported ${label.toLowerCase()}`) : `Target · ${isPercent ? `${target}% QA` : `${target.toFixed(2)} KPI`}`}</span><span className={delta == null ? "" : (isRank ? delta <= 0 : delta >= 0) ? "kpi-positive" : "kpi-negative"}>{delta == null ? "Add another month to see progress" : `Last month ${delta >= 0 ? "+" : ""}${isRank ? `${Math.round(delta)} rank` : isPercent ? `${delta.toFixed(2)}%` : delta.toFixed(2)}`}</span></div>
  </>;
}
