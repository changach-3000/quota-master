"use client";

import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { formatChange, formatKsh, formatKshCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";

type Props = {
  labels: string[];
  current: number[]; // cents per month
  previous: number[] | null;
  quota: number; // cents
  currentName: string;
  previousName: string | null;
  partialNote?: string;
};

const config = {
  current: { label: "This period", color: "var(--chart-1)" },
  previous: { label: "Last period", color: "var(--chart-5)" },
  previousLine: { label: "Last period", color: "var(--chart-2)" },
} satisfies ChartConfig;

/** Round axis steps (1, 2, 2.5, 5 × 10ⁿ) so ticks read 100k, 200k… not 95k, 190k. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}

function cumulative(xs: number[]) {
  let total = 0;
  return xs.map((x) => (total += x));
}

type Row = { label: string; current: number; previous: number | null };

function TooltipBody({ row, mode, currentName, previousName }: { row: Row; mode: string; currentName: string; previousName: string | null }) {
  const change = row.previous !== null ? formatChange(row.current, row.previous) : null;
  return (
    <div className="flex min-w-44 flex-col gap-1 rounded-[10px] bg-sidebar px-3 py-2.5 text-xs text-white shadow-lg tabular">
      <span className="font-semibold">
        {row.label} {currentName}
        {mode === "cumulative" && " · to date"}
      </span>
      <span className="flex justify-between gap-3">
        <span className="text-sidebar-muted">{currentName}</span>
        {formatKsh(row.current)}
      </span>
      {row.previous !== null && previousName && (
        <span className="flex justify-between gap-3">
          <span className="text-sidebar-muted">{previousName}</span>
          {formatKsh(row.previous)}
        </span>
      )}
      {change && (
        <span className="flex justify-between gap-3">
          <span className="text-sidebar-muted">Change</span>
          <span className={change.startsWith("+") ? "text-green-400" : "text-red-300"}>{change}</span>
        </span>
      )}
    </div>
  );
}

export function CollectionsChart({ labels, current, previous, quota, currentName, previousName, partialNote }: Props) {
  const [mode, setMode] = useState<"monthly" | "cumulative">("monthly");

  const cur = mode === "monthly" ? current : cumulative(current);
  const prev = previous ? (mode === "monthly" ? previous : cumulative(previous)) : null;
  const rows: Row[] = labels.map((label, i) => ({ label, current: cur[i] ?? 0, previous: prev ? (prev[i] ?? 0) : null }));
  const ticks = niceTicks(Math.max(...cur, ...(prev ?? []), mode === "cumulative" ? quota : 0));

  const summary =
    mode === "monthly"
      ? `Monthly collections for ${currentName}${previousName ? ` compared with ${previousName}` : ""}.`
      : `Cumulative collections for ${currentName} reach ${formatKsh(cur.at(-1) ?? 0)} against a ${formatKsh(quota)} quota${
          prev ? `; ${previousName} was at ${formatKsh(prev.at(-1) ?? 0)} by the same date` : ""
        }.`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-4 text-xs text-slate-600">
          {mode === "monthly" ? (
            <>
              <LegendSwatch className="size-2.5 rounded-[3px] bg-chart-1">{currentName}</LegendSwatch>
              {previousName && <LegendSwatch className="size-2.5 rounded-[3px] bg-chart-5">{previousName}, same month</LegendSwatch>}
            </>
          ) : (
            <>
              <LegendSwatch className="h-[3px] w-4 rounded-sm bg-chart-1">{currentName} cumulative</LegendSwatch>
              {previousName && <LegendSwatch className="w-4 border-t-2 border-dashed border-chart-2">{previousName} cumulative</LegendSwatch>}
              <LegendSwatch className="w-4 border-t-2 border-dashed border-warning-text">Quota {formatKsh(quota)}</LegendSwatch>
            </>
          )}
        </div>
        <div role="group" aria-label="Chart view" className="flex gap-0.5 rounded-[10px] bg-muted p-[3px]">
          {(["monthly", "cumulative"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "h-[34px] rounded-lg px-3.5 text-[13px] font-medium transition-colors",
                mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "monthly" ? "Monthly" : "Cumulative vs quota"}
            </button>
          ))}
        </div>
      </div>

      <figure className="m-0">
        <ChartContainer config={config} className="aspect-auto h-[260px] w-full" role="img" aria-label={summary}>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barGap={4}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={(v: number) => formatKshCompact(v)}
              ticks={ticks}
              domain={[0, ticks.at(-1) ?? 0]}
            />
            <ChartTooltip
              cursor={{ fill: "var(--muted)" }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TooltipBody row={payload[0].payload as Row} mode={mode} currentName={currentName} previousName={previousName} />
                ) : null
              }
            />
            {mode === "monthly" ? (
              <>
                {prev && <Bar dataKey="previous" fill="var(--color-previous)" radius={[3, 3, 0, 0]} maxBarSize={18} />}
                <Bar dataKey="current" fill="var(--color-current)" radius={[3, 3, 0, 0]} maxBarSize={18} />
              </>
            ) : (
              <>
                <ReferenceLine y={quota} stroke="var(--warning-text)" strokeDasharray="6 5" strokeWidth={1.5} />
                {prev && (
                  <Line dataKey="previous" stroke="var(--color-previousLine)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                )}
                <Line
                  dataKey="current"
                  stroke="var(--color-current)"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "var(--card)", strokeWidth: 2 }}
                  activeDot={{ r: 5 }}
                />
              </>
            )}
          </ComposedChart>
        </ChartContainer>
        <figcaption className="sr-only">{summary}</figcaption>
      </figure>
      {partialNote && <p className="-mt-2 text-right text-xs text-muted-foreground">{partialNote}</p>}
    </div>
  );
}

function LegendSwatch({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={className} aria-hidden />
      {children}
    </span>
  );
}
