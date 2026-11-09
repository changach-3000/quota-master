"use client";

import { Field, inputClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/page";
import { PASSWORD_MIN } from "@/schemas/password";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { useActionState } from "react";
import { setPassword, type SetPasswordState } from "./actions";

export function SetPasswordForm({ token, email, cta }: { token: string; email: string; cta: string }) {
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(setPassword.bind(null, token, email), {});
  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      {state.error && (
        <div role="alert" className="flex gap-2.5 rounded-[10px] border border-red-200 bg-negative-soft p-3 text-[13px] text-negative-text">
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
          {state.error}
        </div>
      )}
      {/* Lets password managers file the new password under the right account. */}
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      <Field id="password" label="New password" error={state.fieldErrors?.password} hint={`At least ${PASSWORD_MIN} characters. A short sentence works well.`}>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          className={inputClass}
          aria-invalid={!!state.fieldErrors?.password}
          aria-describedby={state.fieldErrors?.password ? "password-error" : "password-hint"}
        />
      </Field>
      <Field id="confirm" label="Repeat password" error={state.fieldErrors?.confirm}>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" className={inputClass} aria-invalid={!!state.fieldErrors?.confirm} />
      </Field>
      <button type="submit" disabled={pending} className={buttonClass("primary", "h-11 w-full")}>
        {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        {cta}
      </button>
    </form>
  );
}
