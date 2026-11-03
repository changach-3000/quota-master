import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { STAFF_ROLES, type Role, type Viewer } from "@/services/viewer";

// TEMPORARY dev-only session until real auth (Argon2id + server sessions) lands.
// The cookie holds a seeded user id and is trusted ONLY when NODE_ENV is
// "development" and DEV_LOGIN=1. Anywhere else this returns null, so every
// protected page refuses access.

export const DEV_SESSION_COOKIE = "qm_dev_user";

export function devLoginEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.DEV_LOGIN === "1";
}

export const getViewer = cache(async (): Promise<Viewer | null> => {
  if (!devLoginEnabled()) return null;
  const userId = (await cookies()).get(DEV_SESSION_COOKIE)?.value;
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return null;

  const user = await prisma.users.findFirst({
    where: { id: userId, is_active: true },
    select: { id: true, role: true, parishioner_id: true },
  });
  if (!user) return null;
  return { userId: user.id, role: user.role as Role, parishionerId: user.parishioner_id };
});

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
