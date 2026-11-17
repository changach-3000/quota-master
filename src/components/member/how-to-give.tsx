"use client";

import { buttonClass } from "@/components/app/page";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Banknote, Smartphone } from "lucide-react";

// The parish receives M-Pesa on the treasurer's own number (handoff §2), so the
// number is configured per parish rather than hard-coded here.
const MPESA_NUMBER = process.env.NEXT_PUBLIC_PARISH_MPESA_NUMBER || "[PARISH M-PESA NUMBER]";

export function HowToGiveButton() {
  return (
    <Dialog>
      <DialogTrigger className={buttonClass("primary")}>
        <Smartphone className="size-4" strokeWidth={2} aria-hidden />
        How to give
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>How to give</DialogTitle>
          <DialogDescription>Your payment shows here once the treasurer records it, usually within a few days.</DialogDescription>
        </DialogHeader>
        <section aria-labelledby="give-mpesa" className="flex flex-col gap-2">
          <h3 id="give-mpesa" className="flex items-center gap-2 text-sm font-semibold">
            <Smartphone className="size-4 text-primary" aria-hidden /> M-Pesa
          </h3>
          <ol className="ml-5 list-decimal space-y-1 text-[13px] text-foreground-soft">
            <li>Open M-Pesa and choose Send Money.</li>
            <li>
              Send to <strong className="tabular">{MPESA_NUMBER}</strong> (parish treasurer).
            </li>
            <li>Keep the confirmation SMS. Its 10-character code is your receipt.</li>
          </ol>
        </section>
        <section aria-labelledby="give-cash" className="flex flex-col gap-2">
          <h3 id="give-cash" className="flex items-center gap-2 text-sm font-semibold">
            <Banknote className="size-4 text-primary" aria-hidden /> Cash
          </h3>
          <p className="text-[13px] text-foreground-soft">Hand it to the treasurer after Mass and ask for a numbered receipt.</p>
        </section>
        <DialogFooter>
          <DialogClose className={buttonClass("secondary")}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
