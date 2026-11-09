import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { prisma } from "@/lib/db";
import { passwordProblem } from "@/schemas/password";
import { assertStaff, ForbiddenError, type Role, type Viewer } from "./viewer";

// Authentication core. No cookies or request objects here: callers pass in
// what they know (token, IP, user agent) so every rule is unit-testable.

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000; // re-sign-in at least weekly
const IDLE_MS: Record<Role, number> = {
  admin: 12 * 60 * 60 * 1000,
  treasurer: 12 * 60 * 60 * 1000,
  auditor: 12 * 60 * 60 * 1000,
  member: 7 * 24 * 60 * 60 * 1000,
};
const TOUCH_EVERY_MS = 5 * 60 * 1000; // avoid a write on every request

export const LOCKOUT = { failures: 5, windowMinutes: 15 };
export const IP_LIMIT = { failures: 30, windowMinutes: 15 };

const TOKEN_TTL_MS = { invite: 7 * 24 * 60 * 60 * 1000, password_reset: 24 * 60 * 60 * 1000 } as const;

// Argon2id with OWASP's minimum (19 MiB, 2 passes, 1 lane): the library defaults.
const ARGON2 = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------
export const newToken = () => randomBytes(32).toString("base64url");
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export const hashPassword = (password: string) => hash(password, ARGON2);

async function verifyPassword(passwordHash: string, password: string) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false; // malformed hash: treat as a mismatch, never as a crash
  }
}

// Verifying against a throwaway hash when the email is unknown keeps the
// response time the same, so timing doesn't reveal which emails exist.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(newToken()));

type Meta = { ip: string | null; userAgent: string | null };

async function audit(action: string, userId: string | null, meta: Meta, after?: Record<string, unknown>) {
  await prisma.$executeRaw`
    INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after_data, ip_address)
    VALUES (${userId}::uuid, ${action}, 'user', ${userId}, ${after ? JSON.stringify(after) : null}::jsonb, ${meta.ip}::inet)`;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
export async function createSession(userId: string, meta: Meta) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_MS);
  await prisma.$executeRaw`
    INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent)
    VALUES (${sha256(token)}, ${userId}::uuid, ${expiresAt}, ${meta.ip}::inet, ${meta.userAgent?.slice(0, 512) ?? null})`;
  // Housekeeping: drop this user's dead sessions.
  await prisma.$executeRaw`DELETE FROM sessions WHERE user_id = ${userId}::uuid AND expires_at < now()`;
  return { token, expiresAt };
}

/** Resolves a session token to a viewer, enforcing absolute and idle expiry. */
export async function validateSession(token: string | undefined | null): Promise<Viewer | null> {
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  // Time comparisons happen in SQL against the database clock, so they never
  // depend on how the driver converts timestamps.
  const [row] = await prisma.$queryRaw<
    { user_id: string; role: Role; parishioner_id: string | null; is_active: boolean; expired: boolean; stale: boolean; idle_ms: number }[]
  >`
    SELECT s.user_id, u.role, u.parishioner_id, u.is_active,
           (s.expires_at <= now()) AS expired,
           (u.password_changed_at IS NOT NULL AND u.password_changed_at > s.created_at) AS stale,
           (extract(epoch FROM now() - s.last_seen_at) * 1000)::float8 AS idle_ms
      FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ${id}`;
  if (!row) return null;

  if (!row.is_active || row.expired || row.stale || row.idle_ms > IDLE_MS[row.role]) {
    await prisma.$executeRaw`DELETE FROM sessions WHERE id = ${id}`;
    return null;
  }
  if (row.idle_ms > TOUCH_EVERY_MS) {
    await prisma.$executeRaw`UPDATE sessions SET last_seen_at = now() WHERE id = ${id}`;
  }
  return { userId: row.user_id, role: row.role, parishionerId: row.parishioner_id };
}

export async function revokeSession(token: string | undefined | null, meta: Meta) {
  if (!token) return;
  const [row] = await prisma.$queryRaw<{ user_id: string }[]>`DELETE FROM sessions WHERE id = ${sha256(token)} RETURNING user_id`;
  if (row) await audit("user.signed_out", row.user_id, meta);
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------
export type SignInResult =
  | { ok: true; token: string; expiresAt: Date; viewer: Viewer }
  | { ok: false; reason: "invalid" | "locked" | "rate_limited" };

async function recentFailures(emailLower: string, ip: string | null) {
  const [row] = await prisma.$queryRaw<{ email_failures: number; ip_failures: number }[]>`
    SELECT
      (SELECT COUNT(*)::int FROM sign_in_attempts a
        WHERE a.email_lower = ${emailLower} AND NOT a.succeeded
          AND a.attempted_at > now() - make_interval(mins => ${LOCKOUT.windowMinutes})
          AND a.attempted_at > COALESCE((SELECT max(attempted_at) FROM sign_in_attempts
                                          WHERE email_lower = ${emailLower} AND succeeded), '-infinity')) AS email_failures,
      (SELECT COUNT(*)::int FROM sign_in_attempts a
        WHERE ${ip}::inet IS NOT NULL AND a.ip_address = ${ip}::inet AND NOT a.succeeded
          AND a.attempted_at > now() - make_interval(mins => ${IP_LIMIT.windowMinutes})) AS ip_failures`;
  return row;
}

export async function signInWithPassword(email: string, password: string, meta: Meta): Promise<SignInResult> {
  const emailLower = email.trim().toLowerCase();
  const failures = await recentFailures(emailLower, meta.ip);
  if (failures.ip_failures >= IP_LIMIT.failures) return { ok: false, reason: "rate_limited" };
  if (failures.email_failures >= LOCKOUT.failures) return { ok: false, reason: "locked" };

  const user = await prisma.users.findFirst({
    where: { email: { equals: emailLower, mode: "insensitive" } },
    select: { id: true, role: true, parishioner_id: true, is_active: true, password_hash: true },
  });

  const ok =
    user?.password_hash && user.is_active
      ? await verifyPassword(user.password_hash, password)
      : (await verifyPassword(await getDummyHash(), password), false);

  await prisma.$executeRaw`
    INSERT INTO sign_in_attempts (email_lower, ip_address, succeeded) VALUES (${emailLower}, ${meta.ip}::inet, ${ok})`;

  if (!ok || !user) {
    if (user) {
      const lockedNow = failures.email_failures + 1 >= LOCKOUT.failures;
      await prisma.users.update({
        where: { id: user.id },
        data: {
          failed_login_count: { increment: 1 },
          ...(lockedNow ? { locked_until: new Date(Date.now() + LOCKOUT.windowMinutes * 60_000) } : {}),
        },
      });
      await audit(lockedNow ? "user.locked_out" : "user.sign_in_failed", user.id, meta);
    }
    return { ok: false, reason: "invalid" };
  }

  await prisma.users.update({ where: { id: user.id }, data: { failed_login_count: 0, locked_until: null } });
  const session = await createSession(user.id, meta);
  await audit("user.signed_in", user.id, meta);
  return {
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    viewer: { userId: user.id, role: user.role as Role, parishionerId: user.parishioner_id },
  };
}

// ---------------------------------------------------------------------------
// Invites and password resets (single-use links)
// ---------------------------------------------------------------------------
async function issueToken(userId: string, purpose: "invite" | "password_reset", createdBy: string) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS[purpose]);
  await prisma.$executeRaw`
    INSERT INTO user_tokens (token_hash, user_id, purpose, created_by, expires_at)
    VALUES (${sha256(token)}, ${userId}::uuid, ${purpose}::user_token_purpose, ${createdBy}::uuid, ${expiresAt})`;
  return { token, expiresAt };
}

export type InviteInput = { email: string; role: Role; parishionerId: string | null };

/** Admin only. Creates the user without a password and returns a one-time link token. */
export async function inviteUser(viewer: Viewer | null, input: InviteInput, meta: Meta) {
  assertStaff(viewer);
  if (viewer.role !== "admin") throw new ForbiddenError("Only an admin can invite people");
  const email = input.email.trim().toLowerCase();
  const user = await prisma.users.create({
    data: { email, role: input.role, parishioner_id: input.role === "member" ? input.parishionerId : null },
    select: { id: true },
  });
  const issued = await issueToken(user.id, "invite", viewer.userId);
  await audit("user.invited", viewer.userId, meta, { invited_user_id: user.id, role: input.role });
  return { userId: user.id, ...issued };
}

/** Admin only. Signs the user out everywhere and returns a reset link token. */
export async function issuePasswordReset(viewer: Viewer | null, userId: string, meta: Meta) {
  assertStaff(viewer);
  if (viewer.role !== "admin") throw new ForbiddenError("Only an admin can reset access");
  await prisma.$executeRaw`DELETE FROM sessions WHERE user_id = ${userId}::uuid`;
  const issued = await issueToken(userId, "password_reset", viewer.userId);
  await audit("user.password_reset_issued", viewer.userId, meta, { user_id: userId });
  return issued;
}

export type TokenInfo = { status: "valid"; email: string; purpose: "invite" | "password_reset" } | { status: "invalid" | "expired" | "used" };

export async function inspectToken(token: string): Promise<TokenInfo> {
  if (!token || token.length > 100) return { status: "invalid" };
  const [row] = await prisma.$queryRaw<{ email: string; purpose: "invite" | "password_reset"; expired: boolean; used: boolean; is_active: boolean }[]>`
    SELECT u.email, t.purpose, (t.expires_at <= now()) AS expired, (t.used_at IS NOT NULL) AS used, u.is_active
      FROM user_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ${sha256(token)}`;
  if (!row || !row.is_active) return { status: "invalid" };
  if (row.used) return { status: "used" };
  if (row.expired) return { status: "expired" };
  return { status: "valid", email: row.email, purpose: row.purpose };
}

/**
 * Sets the password from an invite or reset link and signs the user in.
 * Marking the token used and setting the password happen in one transaction,
 * and the UPDATE only matches an unused, unexpired token, so two concurrent
 * submissions can't both succeed.
 */
export async function redeemToken(token: string, password: string, meta: Meta): Promise<SignInResult | { ok: false; reason: "weak"; message: string }> {
  const info = await inspectToken(token);
  if (info.status !== "valid") return { ok: false, reason: "invalid" };
  const problem = passwordProblem(password, info.email);
  if (problem) return { ok: false, reason: "weak", message: problem };

  const passwordHash = await hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    const [claimed] = await tx.$queryRaw<{ user_id: string; purpose: string }[]>`
      UPDATE user_tokens SET used_at = now()
       WHERE token_hash = ${sha256(token)} AND used_at IS NULL AND expires_at > now()
       RETURNING user_id, purpose::text`;
    if (!claimed) return null;
    const [u] = await tx.$queryRaw<{ id: string; role: Role; parishioner_id: string | null }[]>`
      UPDATE users SET password_hash = ${passwordHash}, password_changed_at = now(), failed_login_count = 0, locked_until = NULL
       WHERE id = ${claimed.user_id}::uuid
       RETURNING id, role, parishioner_id`;
    await tx.$executeRaw`DELETE FROM sessions WHERE user_id = ${u.id}::uuid`;
    return { ...u, purpose: claimed.purpose };
  });
  if (!user) return { ok: false, reason: "invalid" };

  await audit(user.purpose === "invite" ? "user.invite_accepted" : "user.password_reset", user.id, meta);
  // Both timestamps come from the database clock, and this session is created
  // in a later transaction, so it is never mistaken for a pre-change session.
  const session = await createSession(user.id, meta);
  return {
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    viewer: { userId: user.id, role: user.role as Role, parishionerId: user.parishioner_id },
  };
}

// ---------------------------------------------------------------------------
// Password change (signed in)
// ---------------------------------------------------------------------------
export type ChangePasswordResult = { ok: true; token: string; expiresAt: Date } | { ok: false; field: "current" | "next"; message: string };

/** Verifies the current password, sets the new one, and signs out every other device. */
export async function changePassword(viewer: Viewer | null, current: string, next: string, meta: Meta): Promise<ChangePasswordResult> {
  if (!viewer) throw new ForbiddenError();
  const user = await prisma.users.findUnique({ where: { id: viewer.userId }, select: { email: true, password_hash: true } });
  if (!user?.password_hash || !(await verifyPassword(user.password_hash, current))) {
    return { ok: false, field: "current", message: "Your current password isn't right" };
  }
  const problem = passwordProblem(next, user.email);
  if (problem) return { ok: false, field: "next", message: problem };
  if (await verifyPassword(user.password_hash, next)) return { ok: false, field: "next", message: "Choose a different password from your current one" };

  const newHash = await hashPassword(next);
  await prisma.$executeRaw`UPDATE users SET password_hash = ${newHash}, password_changed_at = now() WHERE id = ${viewer.userId}::uuid`;
  await prisma.$executeRaw`DELETE FROM sessions WHERE user_id = ${viewer.userId}::uuid`;
  await audit("user.password_changed", viewer.userId, meta);
  const session = await createSession(viewer.userId, meta);
  return { ok: true, token: session.token, expiresAt: session.expiresAt };
}
