"use client";

import { Field, inputClass, selectClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/page";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { parishionerSchema } from "@/schemas/settings";
import { addParishionerAction } from "./actions";

export function AddParishionerButton({ churches }: { churches: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const input = { displayName: data.displayName, churchId: data.churchId, household: data.household || undefined, phone: data.phone };
    const parsed = parishionerSchema.safeParse(input);
    if (!parsed.success) {
      const fe = z.flattenError(parsed.error).fieldErrors;
      setErrors({ displayName: fe.displayName?.[0], churchId: fe.churchId?.[0], phone: fe.phone?.[0] });
      return;
    }
    setPending(true);
    try {
      const result = await addParishionerAction(input);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? { displayName: result.message });
        return;
      }
      setErrors({});
      setOpen(false);
      toast.success(`${result.name} added`, { description: "Set their pledge from the Pledges page." });
    } catch {
      setErrors({ displayName: "Couldn't reach the server. Nothing was saved; try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonClass("primary")}>
        <UserPlus className="size-4" aria-hidden />
        Add parishioner
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add parishioner</DialogTitle>
            <DialogDescription>Set their pledge afterwards from the Pledges page.</DialogDescription>
          </DialogHeader>
          <Field id="p-name" label="Name" error={errors.displayName}>
            <input id="p-name" name="displayName" className={inputClass} aria-invalid={!!errors.displayName} />
          </Field>
          <Field id="p-church" label="Church" error={errors.churchId}>
            <select id="p-church" name="churchId" defaultValue="" className={selectClass} aria-invalid={!!errors.churchId}>
              <option value="" disabled>
                Choose a church
              </option>
              {churches.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="p-household" label="Household" optional hint="Groups family members, e.g. “Household 12”.">
            <input id="p-household" name="household" className={inputClass} />
          </Field>
          <Field id="p-phone" label="Phone" optional error={errors.phone} hint="Helps match M-Pesa messages to the right person.">
            <input id="p-phone" name="phone" type="tel" inputMode="tel" className={inputClass} aria-invalid={!!errors.phone} />
          </Field>
          <DialogFooter>
            <DialogClose className={buttonClass("secondary")}>Cancel</DialogClose>
            <button type="submit" disabled={pending} className={buttonClass("primary")}>
              {pending ? "Adding…" : "Add parishioner"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
