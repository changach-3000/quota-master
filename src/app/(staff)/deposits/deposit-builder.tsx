"use client";

import { Field, inputClass } from "@/components/app/form";
import { buttonClass, EmptyState } from "@/components/app/page";
import { Panel } from "@/components/dashboard/primitives";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatKsh } from "@/lib/format";
import { cn } from "@/lib/utils";
import { kshAmount } from "@/schemas/money";
import type { UndepositedPayment } from "@/services/deposits";
import { CircleCheck, Landmark, LoaderCircle, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { recordDepositAction } from "./actions";

const METHOD = { mpesa: "M-Pesa", cash: "Cash" } as const;

export function DepositBuilder({ payments, today }: { payments: UndepositedPayment[]; today: string }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(payments.map((p) => p.id)));
  const [method, setMethod] = useState<"all" | "mpesa" | "cash">("all");
  const [depositedOn, setDepositedOn] = useState(today);
  const [bankRef, setBankRef] = useState("");
  const [slipAmount, setSlipAmount] = useState("");
  const [errors, setErrors] = useState<{ slip?: string; date?: string; items?: string }>({});
  const [pending, setPending] = useState(false);
  // One key per form: a retry or double-click can't bank the same payments twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const router = useRouter();

  const visible = method === "all" ? payments : payments.filter((p) => p.method === method);
  const total = useMemo(() => payments.filter((p) => selected.has(p.id)).reduce((s, p) => s + p.amount, 0), [payments, selected]);
  const slip = kshAmount.safeParse(slipAmount);
  const slipCents = slip.success ? slip.data : null;
  const mismatch = slipCents !== null && slipCents !== total;
  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));

  function toggle(id: string, on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      for (const p of visible) {
        if (on) next.add(p.id);
        else next.delete(p.id);
      }
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const next: typeof errors = {};
    if (selected.size === 0) next.items = "Select the payments that went into this deposit";
    if (!slip.success) next.slip = slip.error.issues[0]?.message ?? "Enter the amount on the deposit slip";
    else if (mismatch) next.slip = `The slip says ${formatKsh(slipCents!)} but the selected payments add up to ${formatKsh(total)}`;
    if (!depositedOn || depositedOn > today) next.date = "Enter the date the money was banked (not in the future)";
    setErrors(next);
    if (Object.keys(next).length) return;

    setPending(true);
    try {
      // The server totals the payments itself; the slip amount is only checked against it.
      const result = await recordDepositAction({
        contributionIds: payments.filter((p) => selected.has(p.id)).map((p) => p.id),
        depositedOn,
        slipAmount,
        bankRef: bankRef || undefined,
        idempotencyKey,
      });
      if (result.ok) {
        toast.success(`Deposit of ${formatKsh(result.amount)} recorded`, {
          description: `${result.items} payment${result.items === 1 ? "" : "s"} marked as banked on ${formatDate(depositedOn)}.`,
        });
        router.refresh();
        return;
      }
      const err = result.error;
      if (err.code === "invalid") {
        setErrors({ items: err.fieldErrors.contributionIds, slip: err.fieldErrors.slipAmount, date: err.fieldErrors.depositedOn });
      } else if (err.code === "mismatch") {
        setErrors({ slip: `The selected payments add up to ${formatKsh(err.selectedTotal)}. Check the slip.` });
      } else if (err.code === "future_date" || err.code === "before_received") {
        setErrors({ date: err.message });
      } else {
        setErrors({ items: err.message });
        if (err.code === "already_deposited" || err.code === "not_depositable") router.refresh();
      }
    } catch {
      toast.error("Couldn't reach the server", { description: "Nothing was recorded. It is safe to press Record deposit again." });
    } finally {
      setPending(false);
    }
  }

  if (payments.length === 0) {
    return (
      <Panel>
        <EmptyState title="Nothing waiting to deposit" icon={CircleCheck}>
          Every payment received has been banked.
        </EmptyState>
      </Panel>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-start gap-4">
      <Panel aria-labelledby="waiting-title" className="min-w-0 flex-[2_1_520px] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-[18px]">
          <div>
            <h2 id="waiting-title" className="text-base font-semibold">
              Waiting to deposit
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Tick the payments that are in this deposit.</p>
          </div>
          <div role="group" aria-label="Show method" className="flex gap-0.5 rounded-[10px] bg-muted p-[3px]">
            {(["all", "mpesa", "cash"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={method === m}
                onClick={() => setMethod(m)}
                className={cn("h-8 rounded-lg px-3 text-[13px] font-medium", method === m ? "bg-card shadow-sm" : "text-muted-foreground")}
              >
                {m === "all" ? "All" : METHOD[m]}
              </button>
            ))}
          </div>
        </div>
        {errors.items && (
          <p role="alert" className="mx-5 mb-3 text-xs font-medium text-negative">
            {errors.items}
          </p>
        )}
        <div className="max-h-[440px] overflow-y-auto">
          <Table className="min-w-[560px] text-[13px]">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow className="border-t border-border hover:bg-background">
                <TableHead className="w-12 pl-5">
                  <Checkbox checked={allVisibleSelected} onCheckedChange={(v) => toggleAll(!!v)} aria-label="Select all shown" />
                </TableHead>
                <TableHead className="font-medium text-muted-foreground">Parishioner</TableHead>
                <TableHead className="font-medium text-muted-foreground">Reference</TableHead>
                <TableHead className="font-medium text-muted-foreground">Received</TableHead>
                <TableHead className="pr-5 text-right font-medium text-muted-foreground">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((p) => (
                <TableRow key={p.id} className="border-slate-100" data-state={selected.has(p.id) ? "selected" : undefined}>
                  <TableCell className="pl-5">
                    <Checkbox checked={selected.has(p.id)} onCheckedChange={(v) => toggle(p.id, !!v)} aria-label={`Include ${p.parishioner}, ${formatKsh(p.amount)}`} />
                  </TableCell>
                  <TableCell className="py-3">
                    <span className="flex flex-col">
                      <span className="font-medium">{p.parishioner}</span>
                      <span className="text-xs text-muted-foreground">{p.church}</span>
                    </span>
                  </TableCell>
                  <TableCell className="py-3">
                    <span className="flex flex-col">
                      <span>{METHOD[p.method]}</span>
                      <span className="font-mono text-xs text-muted-foreground">{p.reference}</span>
                    </span>
                  </TableCell>
                  <TableCell className="py-3 whitespace-nowrap text-slate-600 tabular">{formatDate(p.receivedOn)}</TableCell>
                  <TableCell className="py-3 pr-5 text-right font-semibold tabular">{formatKsh(p.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Panel>

      <Panel aria-labelledby="record-title" className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 p-5">
        <h2 id="record-title" className="text-base font-semibold">
          Record deposit
        </h2>
        <div className="flex items-baseline justify-between rounded-[10px] bg-muted p-3">
          <span className="text-[13px] text-muted-foreground">{selected.size} selected</span>
          <span className="text-xl font-semibold tabular">{formatKsh(total)}</span>
        </div>
        <Field id="deposited-on" label="Date banked" error={errors.date}>
          <input id="deposited-on" type="date" max={today} value={depositedOn} onChange={(e) => setDepositedOn(e.target.value)} className={inputClass} aria-invalid={!!errors.date} />
        </Field>
        <Field id="slip-amount" label="Amount on the deposit slip (KSh)" error={errors.slip} hint="Must match the selected payments exactly.">
          <input
            id="slip-amount"
            inputMode="decimal"
            value={slipAmount}
            onChange={(e) => setSlipAmount(e.target.value.replace(/[^\d.,]/g, ""))}
            className={cn(inputClass, "tabular")}
            aria-invalid={!!errors.slip || mismatch}
            aria-describedby={errors.slip ? "slip-amount-error" : "slip-amount-hint"}
          />
        </Field>
        {mismatch && !errors.slip && (
          <p className="flex gap-2 rounded-[10px] border border-amber-200 bg-warning-soft p-3 text-[13px] text-warning-text tabular">
            <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden />
            Off by {formatKsh(Math.abs(slipCents! - total))}. Check the slip or the ticked payments.
          </p>
        )}
        {slipCents !== null && !mismatch && (
          <p className="flex items-center gap-2 text-[13px] font-medium text-positive-text">
            <CircleCheck className="size-4" aria-hidden /> Slip matches the selected payments
          </p>
        )}
        <Field id="bank-ref" label="Bank reference" optional hint="From the NCBA slip or app.">
          <input id="bank-ref" value={bankRef} onChange={(e) => setBankRef(e.target.value)} className={cn(inputClass, "font-mono")} />
        </Field>
        <button type="submit" disabled={pending} className={buttonClass("primary", "w-full")}>
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Landmark className="size-4" aria-hidden />}
          {pending ? "Recording…" : "Record deposit"}
        </button>
      </Panel>
    </form>
  );
}
