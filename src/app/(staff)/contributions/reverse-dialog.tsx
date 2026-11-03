"use client";

import { Field, textareaClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/page";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatDate, formatKsh } from "@/lib/format";
import { TriangleAlert, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Contribution = { parishioner: string; amount: number; reference: string; receivedOn: string; deposited: boolean };

const REASONS = ["Entered twice", "Wrong amount entered", "Recorded against the wrong parishioner", "Payment bounced or was refunded"];

/** Reversal is the only way to correct a payment. A reason is required. */
export function ReverseButton({ contribution: c }: { contribution: Contribution }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 5) {
      setError("Give a reason of at least a few words. It is kept in the audit log.");
      return;
    }
    setOpen(false);
    setReason("");
    setError(undefined);
    toast.info("Reversal checked and ready", { description: "Saving to the ledger is connected in the backend milestone." });
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
            <p className="flex gap-2 rounded-[10px] border border-amber-200 bg-warning-soft p-3 text-[13px] text-warning-text">
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
            <button type="submit" className={buttonClass("danger")}>
              <Undo2 className="size-4" aria-hidden />
              Reverse payment
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
