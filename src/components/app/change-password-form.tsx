"use client";

import { changePasswordAction, type ChangePasswordState } from "@/app/account-actions";
import { PASSWORD_MIN } from "@/schemas/password";
import { CircleCheck, LoaderCircle } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";
import { Field, inputClass } from "./form";
import { buttonClass } from "./page";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(changePasswordAction, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={action} noValidate className="flex flex-col gap-4">
      {state.ok && (
        <p role="status" className="flex items-center gap-2 rounded-[10px] bg-positive-soft p-3 text-[13px] font-medium text-positive-text">
          <CircleCheck className="size-4" aria-hidden />
          Password changed. You&apos;ve been signed out on other devices.
        </p>
      )}
      <Field id="pw-current" label="Current password" error={state.fieldErrors?.current}>
        <input id="pw-current" name="current" type="password" autoComplete="current-password" className={inputClass} aria-invalid={!!state.fieldErrors?.current} />
      </Field>
      <Field id="pw-next" label="New password" error={state.fieldErrors?.next} hint={`At least ${PASSWORD_MIN} characters.`}>
        <input id="pw-next" name="next" type="password" autoComplete="new-password" className={inputClass} aria-invalid={!!state.fieldErrors?.next} />
      </Field>
      <Field id="pw-confirm" label="Repeat new password" error={state.fieldErrors?.confirm}>
        <input id="pw-confirm" name="confirm" type="password" autoComplete="new-password" className={inputClass} aria-invalid={!!state.fieldErrors?.confirm} />
      </Field>
      <button type="submit" disabled={pending} className={buttonClass("primary", "self-start")}>
        {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        Change password
      </button>
    </form>
  );
}
