"use client";

import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { formatKsh, formatKshCompact } from "@/lib/format";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";

const config = { total: { label: "Collected", color: "var(--chart-1)" } } satisfies ChartConfig;

/** Church-level monthly totals. Sums of money only, never people. */
export function ChurchTrend({ labels, values, churchName }: { labels: string[]; values: number[]; churchName: string }) {
  const rows = labels.map((label, i) => ({ label, total: values[i] ?? 0 }));
  const best = rows.reduce((a, b) => (b.total > a.total ? b : a), rows[0]);
  const summary = `${churchName} monthly collections${best ? `, highest in ${best.label} at ${formatKsh(best.total)}` : ""}.`;
  return (
    <ChartContainer config={config} className="aspect-auto h-[170px] w-full" role="img" aria-label={summary}>
      <BarChart data={rows} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(l: string) => l.slice(0, 1)} />
        <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => formatKshCompact(v)} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)" }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <div className="rounded-lg bg-sidebar px-2.5 py-1.5 text-xs text-white shadow-lg tabular">
                <span className="font-semibold">{payload[0].payload.label}</span> · {formatKsh(payload[0].payload.total)}
              </div>
            ) : null
          }
        />
        <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={24}>
          {rows.map((r, i) => (
            // The current (partial) month is lighter so it doesn't read as a drop.
            <Cell key={r.label + i} fill={i === rows.length - 1 ? "#86CFA0" : "var(--color-total)"} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
