"use server";

import { prisma } from "@/lib/db";
import { clearSessionCookie, devLoginEnabled, readSessionToken, requestMeta, setSessionCookie } from "@/lib/session";
import { createSession, LOCKOUT, revokeSession, signInWithPassword } from "@/services/auth";
import { STAFF_ROLES } from "@/services/viewer";
import { redirect } from "next/navigation";
import { z } from "zod";

export type SignInState = { error?: string; fieldErrors?: { email?: string; password?: string }; email?: string };

const credentials = z.object({
  email: z.email("Enter a valid email address").max(254),
  password: z.string().min(1, "Enter your password").max(512),
});

const MESSAGES = {
  // One message for unknown email and wrong password, so the form can't be used to test which emails have accounts.
  invalid: "That email and password don't match. Check them and try again.",
  locked: `Too many attempts. For your security, wait ${LOCKOUT.windowMinutes} minutes, or ask the treasurer to reset your access.`,
  rate_limited: "Too many sign-in attempts from this network. Wait a few minutes and try again.",
} as const;

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const parsed = credentials.safeParse({ email, password: formData.get("password") });
  if (!parsed.success) {
    const errors = z.flattenError(parsed.error).fieldErrors;
    return { email, fieldErrors: { email: errors.email?.[0], password: errors.password?.[0] } };
  }

  const result = await signInWithPassword(parsed.data.email, parsed.data.password, await requestMeta());
  if (!result.ok) return { email, error: MESSAGES[result.reason] };

  await setSessionCookie(result.token, result.expiresAt);
  redirect(STAFF_ROLES.includes(result.viewer.role) ? "/dashboard" : "/me");
}

// Demo accounts: a real session for a seeded @example.test user, without the
// password. Only in development with DEV_LOGIN=1; refused everywhere else.
export async function signInAsDemo(formData: FormData) {
  if (!devLoginEnabled()) throw new Error("Demo sign-in is disabled");
  const email = String(formData.get("email") ?? "").toLowerCase();
  if (!email.endsWith("@example.test")) throw new Error("Demo sign-in is only for demo accounts");
  const user = await prisma.users.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, is_active: true },
    select: { id: true },
  });
  if (!user) throw new Error("Unknown demo user");
  const session = await createSession(user.id, await requestMeta());
  await setSessionCookie(session.token, session.expiresAt);
  redirect("/");
}

export async function signOut() {
  await revokeSession(await readSessionToken(), await requestMeta());
  await clearSessionCookie();
  redirect("/login");
}
