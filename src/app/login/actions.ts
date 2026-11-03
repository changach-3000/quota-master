"use server";

import { prisma } from "@/lib/db";
import { DEV_SESSION_COOKIE, devLoginEnabled } from "@/lib/session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

export type SignInState = { error?: string; fieldErrors?: { email?: string; password?: string }; email?: string };

const credentials = z.object({
  email: z.email("Enter a valid email address").max(254),
  password: z.string().min(1, "Enter your password").max(512),
});

/**
 * Email + password sign-in. The form and validation are final; verifying the
 * Argon2id hash and creating a server session arrive with the backend
 * milestone, so for now this always declines without revealing whether the
 * account exists.
 */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) {
    const errors = z.flattenError(parsed.error).fieldErrors;
    return { email, fieldErrors: { email: errors.email?.[0], password: errors.password?.[0] } };
  }
  return {
    email,
    error: devLoginEnabled()
      ? "Password sign-in isn't connected yet. Use a demo account below."
      : "Password sign-in isn't available yet.",
  };
}

// TEMPORARY: picks a seeded demo user without a password. Disabled unless
// NODE_ENV=development and DEV_LOGIN=1. Removed when real auth lands.
export async function signInAsDemo(formData: FormData) {
  if (!devLoginEnabled()) throw new Error("Demo sign-in is disabled");
  const email = String(formData.get("email") ?? "");
  const user = await prisma.users.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, is_active: true },
    select: { id: true },
  });
  if (!user) throw new Error("Unknown demo user");
  (await cookies()).set(DEV_SESSION_COOKIE, user.id, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/");
}

export async function signOut() {
  (await cookies()).delete(DEV_SESSION_COOKIE);
  redirect("/login");
}
