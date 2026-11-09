import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { validateSession } from "@/services/auth";
import { STAFF_ROLES, type Viewer } from "@/services/viewer";

// The session cookie holds a random token; the database holds only its hash
// (see services/auth.ts). In production the __Host- prefix makes the browser
// insist on Secure, Path=/ and no Domain, so subdomains can't plant or read it.

const PROD = process.env.NODE_ENV === "production";
export const SESSION_COOKIE = PROD ? "__Host-qm_session" : "qm_session";

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: PROD,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Client IP and user agent for audit and rate limiting. */
export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  // x-forwarded-for is only trustworthy behind a proxy we control (set
  // TRUST_PROXY=1 in deployment). Otherwise we record no IP rather than a spoofable one.
  const forwarded = process.env.TRUST_PROXY === "1" ? h.get("x-forwarded-for")?.split(",")[0]?.trim() : null;
  const ip = forwarded && /^[0-9a-fA-F.:]{3,45}$/.test(forwarded) ? forwarded : null;
  return { ip, userAgent: h.get("user-agent") };
}

/** The signed-in viewer for this request, or null. Cached per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => validateSession(await readSessionToken()));

/** Password-less demo sign-in: development builds with DEV_LOGIN=1 only. */
export function devLoginEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.DEV_LOGIN === "1";
}

/** Page guard: signed-in admin, treasurer or auditor, else redirect. */
export async function requireStaffViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!STAFF_ROLES.includes(viewer.role)) redirect("/me");
  return viewer;
}

/** Page guard: signed-in user with their own parishioner record. */
export async function requireMemberViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.parishionerId) redirect("/dashboard");
  return viewer;
}

/** Auditors are read-only everywhere. */
export function canWrite(viewer: Viewer): boolean {
  return viewer.role === "admin" || viewer.role === "treasurer";
}
