"use client";

import { Field, inputClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/page";
import { CircleAlert, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useActionState, useState } from "react";
import { signIn, type SignInState } from "./actions";

export function SignInForm() {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});
  const [show, setShow] = useState(false);

  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      {state.error && (
        <div role="alert" className="flex gap-2.5 rounded-[10px] border border-amber-200 bg-warning-soft p-3 text-[13px] text-warning-text">
          <CircleAlert className="mt-px size-4 shrink-0" strokeWidth={2} aria-hidden />
          {state.error}
        </div>
      )}
      <Field id="email" label="Email" error={state.fieldErrors?.email}>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state.email}
          aria-invalid={!!state.fieldErrors?.email}
          aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
          className={inputClass}
        />
      </Field>
      <Field id="password" label="Password" error={state.fieldErrors?.password}>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
            aria-invalid={!!state.fieldErrors?.password}
            aria-describedby={state.fieldErrors?.password ? "password-error" : undefined}
            className={`${inputClass} pr-12`}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
            className="absolute top-0.5 right-0.5 flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
          >
            {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        </div>
      </Field>
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="text-muted-foreground">Forgot your password? Ask the parish treasurer to reset your access.</span>
      </div>
      <button type="submit" disabled={pending} className={buttonClass("primary", "h-11 w-full")}>
        {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        Sign in
      </button>
    </form>
  );
}
