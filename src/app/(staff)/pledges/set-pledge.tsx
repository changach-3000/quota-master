"use client";

import { Field, inputClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/page";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatKsh } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isoDate, kshAmount } from "@/schemas/money";
import { Target } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/** Setting a pledge never edits the old one: it adds version N+1 from an effective date. */
export function SetPledgeButton({
  parishioner,
  period,
  current,
  variant = "ghost",
}: {
  parishioner: { id: string; name: string };
  period: string;
  current: { amount: number; version: number } | null;
  variant?: "ghost" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date()));
  const [errors, setErrors] = useState<{ amount?: string; from?: string }>({});

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const a = kshAmount.safeParse(amount);
    const d = isoDate.safeParse(from);
    const next = { amount: a.success ? undefined : a.error.issues[0]?.message, from: d.success ? undefined : d.error.issues[0]?.message };
    if (a.success && current && a.data === current.amount) next.amount = "That is the same as the current pledge";
    setErrors(next);
    if (next.amount || next.from) return;
    setOpen(false);
    setAmount("");
    toast.success(`${parishioner.name}: pledge v${(current?.version ?? 0) + 1} of ${formatKsh(a.data!)} is ready to save`, {
      description: "Saving is connected in the backend milestone.",
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={
          variant === "secondary"
            ? buttonClass("secondary")
            : "inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-primary hover:bg-positive-soft"
        }
      >
        <Target className="size-3.5" strokeWidth={2} aria-hidden />
        {current ? "Change pledge" : "Set pledge"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {current ? "Change" : "Set"} {period} pledge
            </DialogTitle>
            <DialogDescription>
              {parishioner.name}
              {current ? ` currently pledges ${formatKsh(current.amount)} (v${current.version}). ` : " has no pledge for this period. "}
              The new amount becomes version {(current?.version ?? 0) + 1}; earlier versions are kept.
            </DialogDescription>
          </DialogHeader>
          <Field id="pledge-amount" label="Pledge for the period (KSh)" error={errors.amount}>
            <input
              id="pledge-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
              className={cn(inputClass, "tabular")}
              aria-invalid={!!errors.amount}
              autoFocus
            />
          </Field>
          <Field id="pledge-from" label="Effective from" error={errors.from}>
            <input id="pledge-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </Field>
          <DialogFooter>
            <DialogClose className={buttonClass("secondary")}>Cancel</DialogClose>
            <button type="submit" className={buttonClass("primary")}>
              Save pledge
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
