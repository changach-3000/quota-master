"use client";

import { ChangePasswordForm } from "@/components/app/change-password-form";
import { Field, inputClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/page";
import { Panel, PanelHeader } from "@/components/dashboard/primitives";
import { kenyanPhone } from "@/schemas/settings";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { updateMyPhoneAction } from "./actions";

export function MemberSettingsForms({ name, church, email, phone }: { name: string; church: string; email: string; phone: string | null }) {
  const [value, setValue] = useState(phone ?? "");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const parsed = kenyanPhone.safeParse(value);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setPending(true);
    try {
      const result = await updateMyPhoneAction(value);
      if (!result.ok) return setError(result.fieldErrors?.phone ?? result.message);
      setError(undefined);
      setValue(result.phone ?? "");
      toast.success(result.phone ? "Phone number saved" : "Phone number removed");
    } catch {
      setError("Couldn't reach the server. Nothing was saved; try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-4">
      <Panel className="flex min-w-0 flex-[1_1_360px] flex-col gap-4 p-5">
        <PanelHeader id="profile-title" title="Profile" description="Your name, church and sign-in email are managed by the parish office." />
        <dl className="grid grid-cols-2 gap-3 text-[13px]">
          <div className="rounded-[10px] bg-muted p-3">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{name}</dd>
          </div>
          <div className="rounded-[10px] bg-muted p-3">
            <dt className="text-muted-foreground">Church</dt>
            <dd className="font-medium">{church}</dd>
          </div>
          <div className="col-span-2 rounded-[10px] bg-muted p-3">
            <dt className="text-muted-foreground">Sign-in email</dt>
            <dd className="font-medium break-all">{email}</dd>
          </div>
        </dl>
        <form noValidate onSubmit={save} className="flex flex-col gap-4">
          <Field id="me-phone" label="Phone" optional error={error} hint="The number you send M-Pesa from helps the treasurer match your payments.">
            <input
              id="me-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0712 345 678"
              className={inputClass}
              aria-invalid={!!error}
            />
          </Field>
          <button type="submit" disabled={pending} className={buttonClass("primary", "self-start")}>
            {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
            {pending ? "Saving…" : "Save phone"}
          </button>
        </form>
      </Panel>

      <Panel className="flex min-w-0 flex-[1_1_360px] flex-col gap-4 p-5">
        <PanelHeader id="password-title" title="Password" description="A short phrase is easier to remember than a jumble of symbols." />
        <ChangePasswordForm />
      </Panel>
    </div>
  );
}
