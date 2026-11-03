import { formatKsh, percent } from "@/lib/format";
import Link from "next/link";
import { Meter, Panel, PanelHeader } from "./primitives";

type Church = { name: string; quota: number; collected: number; pledged: number };

export function ChurchQuotas({
  churches,
  elapsed,
  collected,
  quota,
}: {
  churches: Church[];
  elapsed: number;
  collected: number;
  quota: number;
}) {
  return (
    <Panel aria-labelledby="quota-title" className="flex min-w-0 flex-[1_1_320px] flex-col gap-[18px] p-5">
      <PanelHeader
        id="quota-title"
        title="Church quotas"
        description={`Marker shows year elapsed (${elapsed}%)`}
        action={
          <Link href="/reports" className="text-[13px] font-medium text-primary hover:underline">
            Report
          </Link>
        }
      />
      {churches.map((c) => {
        const pct = percent(c.collected, c.quota);
        return (
          <div key={c.name} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{c.name}</span>
              <span className="font-semibold tabular">{c.quota > 0 ? `${pct}%` : "No quota"}</span>
            </div>
            <Meter
              value={pct}
              label={`${c.name}: share of quota collected`}
              marker={elapsed}
              markerLabel="year elapsed"
            />
            <div className="flex justify-between gap-2 text-xs text-muted-foreground tabular">
              <span>
                {formatKsh(c.collected)} of {formatKsh(c.quota)}
              </span>
              <span>Pledged {formatKsh(c.pledged)}</span>
            </div>
          </div>
        );
      })}
      <div className="mt-auto flex justify-between border-t border-border pt-3.5 text-[13px] tabular">
        <span className="text-muted-foreground">Parish total</span>
        <span className="font-semibold">
          {formatKsh(collected)} / {formatKsh(quota)}
        </span>
      </div>
    </Panel>
  );
}
