"use server";

import { requestMeta, setSessionCookie } from "@/lib/session";
import { newPasswordSchema } from "@/schemas/password";
import { redeemToken } from "@/services/auth";
import { STAFF_ROLES } from "@/services/viewer";
import { redirect } from "next/navigation";
import { z } from "zod";

export type SetPasswordState = { error?: string; fieldErrors?: { password?: string; confirm?: string } };

export async function setPassword(token: string, email: string, _prev: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  const parsed = newPasswordSchema(email).safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) {
    const fe = z.flattenError(parsed.error).fieldErrors;
    return { fieldErrors: { password: fe.password?.[0], confirm: fe.confirm?.[0] } };
  }
  const result = await redeemToken(token, parsed.data.password, await requestMeta());
  if (!result.ok) {
    return result.reason === "weak"
      ? { fieldErrors: { password: result.message } }
      : { error: "This link has already been used or has expired. Ask the parish office for a new one." };
  }
  await setSessionCookie(result.token, result.expiresAt);
  redirect(STAFF_ROLES.includes(result.viewer.role) ? "/dashboard" : "/me");
}
