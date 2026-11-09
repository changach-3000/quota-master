"use client";

import { ChangePasswordForm } from "@/components/app/change-password-form";
import { Field, inputClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/page";
import { Panel, PanelHeader } from "@/components/dashboard/primitives";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

const contactSchema = z.object({
  email: z.email("Enter a valid email address"),
  phone: z
    .string()
    .trim()
    .regex(/^((\+?254|0)[17]\d{8})?$/, "Use a Kenyan number like 0712 345 678"),
});

const notConnected = (what: string) => toast.success(`${what} ready to save`, { description: "Saving is connected in the backend milestone." });

export function MemberSettingsForms({ name, church, email }: { name: string; church: string; email: string }) {
  const [contactErrors, setContactErrors] = useState<Record<string, string | undefined>>({});

  return (
    <div className="flex flex-wrap items-start gap-4">
      <Panel className="flex min-w-0 flex-[1_1_360px] flex-col gap-4 p-5">
        <PanelHeader id="profile-title" title="Profile" description="Your name and church are managed by the treasurer." />
        <dl className="grid grid-cols-2 gap-3 text-[13px]">
          <div className="rounded-[10px] bg-muted p-3">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{name}</dd>
          </div>
          <div className="rounded-[10px] bg-muted p-3">
            <dt className="text-muted-foreground">Church</dt>
            <dd className="font-medium">{church}</dd>
          </div>
        </dl>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const raw = Object.fromEntries(new FormData(e.currentTarget));
            const parsed = contactSchema.safeParse({ ...raw, phone: String(raw.phone ?? "").replace(/\s/g, "") });
            if (!parsed.success) {
              const fe = z.flattenError(parsed.error).fieldErrors;
              return setContactErrors({ email: fe.email?.[0], phone: fe.phone?.[0] });
            }
            setContactErrors({});
            notConnected("Contact details are");
          }}
        >
          <Field id="me-email" label="Email" error={contactErrors.email} hint="Used to sign in.">
            <input id="me-email" name="email" type="email" defaultValue={email} autoComplete="email" className={inputClass} aria-invalid={!!contactErrors.email} />
          </Field>
          <Field id="me-phone" label="Phone" optional error={contactErrors.phone} hint="The number you send M-Pesa from helps the treasurer match payments.">
            <input id="me-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" className={inputClass} aria-invalid={!!contactErrors.phone} />
          </Field>
          <button type="submit" className={buttonClass("primary", "self-start")}>
            Save details
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
