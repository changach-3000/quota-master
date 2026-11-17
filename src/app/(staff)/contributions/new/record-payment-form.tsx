"use client";

import { Field, inputClass, Segmented, textareaClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/page";
import { Panel } from "@/components/dashboard/primitives";
import { formatDate, formatKsh } from "@/lib/format";
import { cn } from "@/lib/utils";
import { recordPaymentSchema } from "@/schemas/contribution";
import { recordPaymentAction } from "../actions";
import { Banknote, Check, CircleAlert, LoaderCircle, Search, Smartphone, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

type Option = { id: string; name: string; church: string; pledged: number; outstanding: number };
type Errors = Partial<Record<"parishionerId" | "mpesaCode" | "receiptNo" | "amount" | "receivedOn" | "notes", string>>;

const DAY = 86_400_000;

export function RecordPaymentForm({ parishioners, today, periodName }: { parishioners: Option[]; today: string; periodName: string | null }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Option | null>(null);
  const [method, setMethod] = useState<"mpesa" | "cash">("mpesa");
  const [mpesaCode, setMpesaCode] = useState("");
  const [receiptNo, setReceiptNo] = useState("");
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState(today);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  // One key per attempt: a double-click or retry can't create two payments.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return parishioners.filter((p) => p.name.toLowerCase().includes(q) || p.church.toLowerCase().includes(q)).slice(0, 6);
  }, [query, parishioners]);

  const cents = Math.round(Number(amount.replace(/,/g, "")) * 100) || 0;
  const daysBack = Math.round((Date.parse(today) - Date.parse(receivedOn)) / DAY);
  const after = selected ? selected.outstanding - cents : null;

  function reset() {
    setSelected(null);
    setQuery("");
    setMpesaCode("");
    setReceiptNo("");
    setAmount("");
    setReceivedOn(today);
    setNotes("");
    setErrors({});
    setIdempotencyKey(crypto.randomUUID());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const input = {
      parishionerId: selected?.id ?? "",
      method,
      mpesaCode: method === "mpesa" ? mpesaCode : undefined,
      receiptNo: method === "cash" ? receiptNo : undefined,
      amount,
      receivedOn,
      notes: notes || undefined,
      idempotencyKey,
    };
    // Check here first for instant feedback; the server repeats every check.
    const parsed = recordPaymentSchema.safeParse(input);
    const extra: Errors = {};
    if (receivedOn > today) extra.receivedOn = "The date can't be in the future";
    if (!parsed.success || Object.keys(extra).length) {
      const fe = parsed.success ? {} : z.flattenError(parsed.error).fieldErrors;
      setErrors({
        parishionerId: fe.parishionerId?.[0],
        mpesaCode: fe.mpesaCode?.[0],
        receiptNo: fe.receiptNo?.[0],
        amount: fe.amount?.[0],
        receivedOn: extra.receivedOn ?? fe.receivedOn?.[0],
        notes: fe.notes?.[0],
      });
      return;
    }

    setErrors({});
    setPending(true);
    try {
      // On failure the key is kept, so retrying can never record the payment twice.
      const result = await recordPaymentAction(input);
      if (result.ok) {
        const b = result.balance;
        toast.success(`${formatKsh(result.amount)} recorded for ${result.parishioner}`, {
          description:
            b.pledged > 0
              ? b.outstanding > 0
                ? `${formatKsh(b.outstanding)} still outstanding on their ${result.period} pledge.`
                : b.credit > 0
                  ? `Pledge complete, with ${formatKsh(b.credit)} credit.`
                  : "Pledge complete."
              : `${formatKsh(b.received)} received from them in ${result.period}.`,
        });
        if (result.backdated) toast.info("Recorded as backdated", { description: "It is flagged in the audit log because the date is over a week ago." });
        reset();
        router.refresh();
        return;
      }
      const err = result.error;
      switch (err.code) {
        case "invalid":
          setErrors(err.fieldErrors as Errors);
          break;
        case "duplicate_mpesa":
          setErrors({
            mpesaCode: `Already recorded${err.existing.receivedOn ? ` on ${formatDate(err.existing.receivedOn)}` : ""} for ${err.existing.parishioner}. Check the SMS.`,
          });
          break;
        case "future_date":
        case "no_period":
          setErrors({ receivedOn: err.message });
          break;
        case "unknown_parishioner":
          setErrors({ parishionerId: err.message });
          break;
        default:
          toast.error("Payment not recorded", { description: err.message });
      }
    } catch {
      toast.error("Couldn't reach the server", { description: "Nothing was recorded. Check your connection and press Record payment again; it is safe to retry." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-start gap-4">
      <Panel className="flex min-w-0 flex-[2_1_520px] flex-col gap-5 p-6">
        {/* Parishioner */}
        <Field id="parishioner" label="Parishioner" error={errors.parishionerId}>
          {selected ? (
            <div className="flex items-center gap-3 rounded-[10px] border border-border bg-background p-3">
              <span className="flex size-9 items-center justify-center rounded-full bg-positive-soft text-[13px] font-semibold text-positive-text">
                {selected.name.split(" ").map((w) => w.replace(/^0+/, "")[0]).join("")}
              </span>
              <span className="flex grow flex-col">
                <span className="font-medium">{selected.name}</span>
                <span className="text-xs text-muted-foreground tabular">
                  {selected.church} · {selected.pledged ? `${formatKsh(selected.outstanding)} outstanding` : "No pledge this period"}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                aria-label={`Change parishioner (${selected.name})`}
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" aria-hidden />
              <input
                id="parishioner"
                type="search"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a name or church"
                className={cn(inputClass, "pl-9")}
                aria-invalid={!!errors.parishionerId}
                aria-controls="parishioner-results"
              />
              {matches.length > 0 && (
                <ul id="parishioner-results" aria-label="Matching parishioners" className="mt-1.5 flex flex-col overflow-hidden rounded-[10px] border border-border bg-card shadow-sm">
                  {matches.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(p);
                          setErrors((e) => ({ ...e, parishionerId: undefined }));
                        }}
                        className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted"
                      >
                        <span className="flex flex-col">
                          <span className="text-sm font-medium">{p.name}</span>
                          <span className="text-xs text-muted-foreground">{p.church}</span>
                        </span>
                        <span className="text-xs text-muted-foreground tabular">
                          {p.pledged ? `${formatKsh(p.outstanding)} to go` : "No pledge"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {query.trim() && matches.length === 0 && <p className="mt-1.5 text-xs text-muted-foreground">No parishioner matches “{query}”.</p>}
            </div>
          )}
        </Field>

        {/* Method */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium" id="method-label">
            Method
          </span>
          <Segmented
            label="Payment method"
            value={method}
            onChange={setMethod}
            options={[
              { value: "mpesa", label: "M-Pesa", icon: <Smartphone className="size-4" aria-hidden /> },
              { value: "cash", label: "Cash", icon: <Banknote className="size-4" aria-hidden /> },
            ]}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {method === "mpesa" ? (
            <Field id="mpesa-code" label="M-Pesa code" error={errors.mpesaCode} hint="From the M-Pesa SMS: 10 letters and numbers.">
              <input
                id="mpesa-code"
                value={mpesaCode}
                onChange={(e) => setMpesaCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))}
                placeholder="SKL3XQ8T2M"
                autoCapitalize="characters"
                spellCheck={false}
                className={cn(inputClass, "font-mono tracking-wider")}
                aria-invalid={!!errors.mpesaCode}
                aria-describedby={errors.mpesaCode ? "mpesa-code-error" : "mpesa-code-hint"}
              />
            </Field>
          ) : (
            <Field id="receipt" label="Receipt number" error={errors.receiptNo} hint="The number on the paper receipt you issued.">
              <input
                id="receipt"
                value={receiptNo}
                onChange={(e) => setReceiptNo(e.target.value)}
                placeholder="R-0413"
                className={inputClass}
                aria-invalid={!!errors.receiptNo}
                aria-describedby={errors.receiptNo ? "receipt-error" : "receipt-hint"}
              />
            </Field>
          )}
          <Field id="amount" label="Amount (KSh)" error={errors.amount}>
            <div className="relative">
              <span className="pointer-events-none absolute top-0 left-3 flex h-11 items-center text-sm text-muted-foreground">KSh</span>
              <input
                id="amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
                placeholder="2,500"
                className={cn(inputClass, "pl-12 tabular")}
                aria-invalid={!!errors.amount}
                aria-describedby={errors.amount ? "amount-error" : undefined}
              />
            </div>
          </Field>
          <Field
            id="received-on"
            label="Date received"
            error={errors.receivedOn}
            hint={daysBack > 7 ? "Backdated more than a week: this will be flagged in the audit log." : undefined}
          >
            <input
              id="received-on"
              type="date"
              max={today}
              value={receivedOn}
              onChange={(e) => setReceivedOn(e.target.value)}
              className={inputClass}
              aria-invalid={!!errors.receivedOn}
            />
          </Field>
        </div>

        <Field id="notes" label="Notes" optional error={errors.notes}>
          <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className={textareaClass} />
        </Field>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-5">
          <button type="button" onClick={reset} className={buttonClass("secondary")}>
            Clear
          </button>
          <button type="submit" disabled={pending} className={buttonClass("primary")}>
            {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            {pending ? "Recording…" : "Record payment"}
          </button>
        </div>
      </Panel>

      {/* Live summary */}
      <Panel aria-labelledby="summary-title" className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 p-5 lg:sticky lg:top-6">
        <h2 id="summary-title" className="text-base font-semibold">
          Summary
        </h2>
        <dl className="flex flex-col gap-2.5 text-[13px]">
          <Row label="Parishioner" value={selected?.name ?? "—"} />
          <Row label="Method" value={method === "mpesa" ? `M-Pesa${mpesaCode ? ` · ${mpesaCode}` : ""}` : `Cash${receiptNo ? ` · ${receiptNo}` : ""}`} />
          <Row label="Received" value={receivedOn ? formatDate(receivedOn) : "—"} />
          <Row label="Period" value={periodName ?? "No open period"} />
          <div className="flex justify-between border-t border-border pt-2.5 text-sm">
            <dt className="font-medium">Amount</dt>
            <dd className="font-semibold tabular">{cents > 0 ? formatKsh(cents) : "—"}</dd>
          </div>
        </dl>
        {selected && cents > 0 && selected.pledged > 0 && after !== null && (
          <p className={cn("rounded-[10px] p-3 text-[13px] tabular", after >= 0 ? "bg-muted text-foreground-soft" : "bg-positive-soft text-positive-text")}>
            {after > 0
              ? `${formatKsh(after)} will still be outstanding on their pledge.`
              : after === 0
                ? "This completes their pledge."
                : `Pledge complete, with ${formatKsh(-after)} kept as credit.`}
          </p>
        )}
        <p className="flex gap-2 text-xs text-muted-foreground">
          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          Payments can&apos;t be edited later. A mistake is fixed by reversing it with a reason and recording it again.
        </p>
      </Panel>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-medium">{value}</dd>
    </div>
  );
}
