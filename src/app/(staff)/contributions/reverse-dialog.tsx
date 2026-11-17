"use client";

import { Field, textareaClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/page";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatDate, formatKsh } from "@/lib/format";
import { LoaderCircle, TriangleAlert, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { reversePaymentAction } from "./actions";

type Contribution = { id: string; parishioner: string; amount: number; reference: string; receivedOn: string; deposited: boolean };

const REASONS = ["Entered twice", "Wrong amount entered", "Recorded against the wrong parishioner", "Payment bounced or was refunded"];

/** Reversal is the only way to correct a payment. A reason is required. */
export function ReverseButton({ contribution: c }: { contribution: Contribution }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  // One key per dialog: a double-click or retry can't create two reversals.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (reason.trim().length < 5) {
      setError("Give a reason of at least a few words. It is kept in the audit log.");
      return;
    }
    setPending(true);
    try {
      const result = await reversePaymentAction({ contributionId: c.id, reason, idempotencyKey });
      if (result.ok) {
        setOpen(false);
        toast.success(`Reversed ${formatKsh(c.amount)} for ${c.parishioner}`, {
          description: "The original stays in the ledger. Record the correct payment if one is due.",
        });
        return;
      }
      if (result.error.code === "invalid") setError(result.error.fieldErrors.reason ?? "Check the reason and try again.");
      else setError(result.error.message);
    } catch {
      setError("Couldn't reach the server. Nothing was changed; it is safe to try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-negative-text hover:bg-negative-soft">
        <Undo2 className="size-3.5" strokeWidth={2} aria-hidden />
        Reverse
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Reverse this payment?</DialogTitle>
            <DialogDescription>
              {formatKsh(c.amount)} from {c.parishioner} on {formatDate(c.receivedOn)} ({c.reference}). The original stays in the ledger and a
              matching reversal is added. To fix it, record the correct payment afterwards.
            </DialogDescription>
          </DialogHeader>
          {c.deposited && (
            <p className="flex gap-2 rounded-[10px] border border-warning-border bg-warning-soft p-3 text-[13px] text-warning-text">
              <TriangleAlert className="mt-px size-4 shrink-0" strokeWidth={2} aria-hidden />
              This payment is already in a bank deposit. Check with the auditor before reversing it.
            </p>
          )}
          <Field id="reverse-reason" label="Reason" error={error} hint="Required. Shown in the audit log and to the auditor.">
            <textarea
              id="reverse-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={textareaClass}
              aria-invalid={!!error}
              aria-describedby={error ? "reverse-reason-error" : "reverse-reason-hint"}
            />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-muted"
              >
                {r}
              </button>
            ))}
          </div>
          <DialogFooter>
            <DialogClose className={buttonClass("secondary")}>Cancel</DialogClose>
            <button type="submit" disabled={pending} className={buttonClass("danger")}>
              {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Undo2 className="size-4" aria-hidden />}
              {pending ? "Reversing…" : "Reverse payment"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
