import { useId } from "react";
import { cn } from "@/lib/utils";

export function ChartContainer({ config, className, children, ...props }) {
  const id = useId().replace(/:/g, "");
  const colors = Object.fromEntries(Object.entries(config ?? {}).map(([key, item]) => [`--color-${key}`, item.color]));
  return <div data-chart={id} className={cn("chart-container", className)} style={colors} {...props}>{children}</div>;
}

export function ChartTooltipContent({ active, payload, label, valueFormatter = (value) => value }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip-content"><p>{label}</p>{payload.map((item) => <div key={item.dataKey}><i style={{ background: item.color }} /><span>{item.name}</span><strong>{valueFormatter(item.value)}</strong></div>)}</div>;
}
