// Sign-in, sessions, lockout, invites and password changes against the real
// test database. Every test uses fresh, random emails so tests don't collide.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  changePassword,
  hashPassword,
  inspectToken,
  inviteUser,
  issuePasswordReset,
  IP_LIMIT,
  LOCKOUT,
  redeemToken,
  revokeSession,
  sha256,
  signInWithPassword,
  validateSession,
} from "@/services/auth";
import { ForbiddenError, type Viewer } from "@/services/viewer";
import { testDatabaseUrl } from "../db/global-setup";

const db = new Client({ connectionString: testDatabaseUrl() });
const meta = { ip: null, userAgent: "vitest" };
const PASSWORD = "correct horse battery staple";

let admin: Viewer;
let parishionerId: string;

async function makeUser(role: "admin" | "treasurer" | "member" = "treasurer", password: string | null = PASSWORD) {
  const email = `${role}-${randomUUID().slice(0, 8)}@auth.test`;
  const passwordHash = password ? await hashPassword(password) : null;
  const pid = role === "member" ? await newParishioner() : null;
  const { rows } = await db.query(
    "INSERT INTO users (email, role, parishioner_id, password_hash) VALUES ($1, $2, $3, $4) RETURNING id",
    [email, role, pid, passwordHash],
  );
  return { id: rows[0].id as string, email, viewer: { userId: rows[0].id, role, parishionerId: pid } as Viewer };
}

async function newParishioner() {
  const { rows } = await db.query(`INSERT INTO parishioners (church_id, display_name) SELECT id, 'Auth Test Person' FROM churches WHERE name = 'Auth Test Church' RETURNING id`);
  return rows[0].id as string;
}

async function signIn(email: string, password = PASSWORD, ip: string | null = null) {
  return signInWithPassword(email, password, { ip, userAgent: "vitest" });
}

beforeAll(async () => {
  await db.connect();
  await db.query(`INSERT INTO churches (name) VALUES ('Auth Test Church')`);
  parishionerId = await newParishioner();
  admin = (await makeUser("admin")).viewer;
});

afterAll(async () => {
  await db.end();
});

describe("password sign-in", () => {
  it("stores Argon2id hashes, never the password", async () => {
    const u = await makeUser();
    const { rows } = await db.query("SELECT password_hash FROM users WHERE id = $1", [u.id]);
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(rows[0].password_hash).not.toContain(PASSWORD);
  });

  it("signs in with the right password and the session resolves to the user", async () => {
    const u = await makeUser("member");
    const result = await signIn(u.email.toUpperCase()); // email match ignores case
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await validateSession(result.token)).toEqual(u.viewer);
  });

  it("stores only a hash of the session token", async () => {
    const u = await makeUser();
    const result = await signIn(u.email);
    if (!result.ok) throw new Error("sign-in failed");
    const { rows } = await db.query("SELECT id FROM sessions WHERE user_id = $1", [u.id]);
    expect(rows.map((r) => r.id)).toEqual([sha256(result.token)]);
    expect(rows[0].id).not.toBe(result.token);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const u = await makeUser();
    expect(await signIn(u.email, "wrong password entirely")).toEqual({ ok: false, reason: "invalid" });
    expect(await signIn(`nobody-${randomUUID()}@auth.test`)).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses accounts with no password yet and disabled accounts", async () => {
    const invited = await makeUser("treasurer", null);
    expect(await signIn(invited.email)).toEqual({ ok: false, reason: "invalid" });
    const disabled = await makeUser();
    await db.query("UPDATE users SET is_active = false WHERE id = $1", [disabled.id]);
    expect(await signIn(disabled.email)).toEqual({ ok: false, reason: "invalid" });
  });

  it(`locks an email after ${LOCKOUT.failures} failures, even for the right password`, async () => {
    const u = await makeUser();
    for (let i = 0; i < LOCKOUT.failures; i++) await signIn(u.email, `wrong-${i}-password`);
    expect(await signIn(u.email)).toEqual({ ok: false, reason: "locked" });
    const { rows } = await db.query("SELECT locked_until FROM users WHERE id = $1", [u.id]);
    expect(rows[0].locked_until).not.toBeNull();
    const audit = await db.query("SELECT action FROM audit_log WHERE actor_user_id = $1 ORDER BY id", [u.id]);
    expect(audit.rows.map((r) => r.action)).toContain("user.locked_out");
  });

  it("locks unknown emails the same way, so lockouts don't reveal which accounts exist", async () => {
    const ghost = `ghost-${randomUUID()}@auth.test`;
    for (let i = 0; i < LOCKOUT.failures; i++) await signIn(ghost, "whatever-password");
    expect(await signIn(ghost)).toEqual({ ok: false, reason: "locked" });
  });

  it("a successful sign-in clears earlier failures", async () => {
    const u = await makeUser();
    for (let i = 0; i < LOCKOUT.failures - 1; i++) await signIn(u.email, "nope-nope-nope");
    expect((await signIn(u.email)).ok).toBe(true);
    for (let i = 0; i < LOCKOUT.failures - 1; i++) await signIn(u.email, "nope-nope-nope");
    expect((await signIn(u.email)).ok).toBe(true);
  });

  it(`rate-limits an IP after ${IP_LIMIT.failures} failures across many emails`, async () => {
    const ip = `10.99.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    for (let i = 0; i < IP_LIMIT.failures; i++) await signIn(`spray-${i}-${randomUUID()}@auth.test`, "password-spray", ip);
    const u = await makeUser();
    expect(await signIn(u.email, PASSWORD, ip)).toEqual({ ok: false, reason: "rate_limited" });
  }, 30_000);
});

describe("sessions", () => {
  it("sign-out deletes the session", async () => {
    const u = await makeUser();
    const r = await signIn(u.email);
    if (!r.ok) throw new Error("sign-in failed");
    await revokeSession(r.token, meta);
    expect(await validateSession(r.token)).toBeNull();
  });

  it("rejects garbage and unknown tokens", async () => {
    expect(await validateSession(undefined)).toBeNull();
    expect(await validateSession("not-a-real-token")).toBeNull();
    expect(await validateSession("x".repeat(500))).toBeNull();
  });

  it("expires at the absolute limit", async () => {
    const u = await makeUser();
    const r = await signIn(u.email);
    if (!r.ok) throw new Error("sign-in failed");
    await db.query("UPDATE sessions SET created_at = now() - interval '8 days', expires_at = now() - interval '1 second' WHERE id = $1", [sha256(r.token)]);
    expect(await validateSession(r.token)).toBeNull();
  });

  it("times out idle staff sessions after 12 hours but not members", async () => {
    const staff = await makeUser("treasurer");
    const member = await makeUser("member");
    const s = await signIn(staff.email);
    const m = await signIn(member.email);
    if (!s.ok || !m.ok) throw new Error("sign-in failed");
    await db.query("UPDATE sessions SET last_seen_at = now() - interval '13 hours' WHERE id = ANY($1)", [[sha256(s.token), sha256(m.token)]]);
    expect(await validateSession(s.token)).toBeNull();
    expect(await validateSession(m.token)).toEqual(member.viewer);
  });

  it("ends sessions for a user who is disabled", async () => {
    const u = await makeUser();
    const r = await signIn(u.email);
    if (!r.ok) throw new Error("sign-in failed");
    await db.query("UPDATE users SET is_active = false WHERE id = $1", [u.id]);
    expect(await validateSession(r.token)).toBeNull();
  });
});

describe("password change", () => {
  it("needs the current password", async () => {
    const u = await makeUser();
    expect(await changePassword(u.viewer, "not my password", "a brand new passphrase", meta)).toMatchObject({ ok: false, field: "current" });
  });

  it("refuses weak new passwords", async () => {
    const u = await makeUser();
    expect(await changePassword(u.viewer, PASSWORD, "short", meta)).toMatchObject({ ok: false, field: "next" });
  });

  it("signs out other devices and keeps a fresh session", async () => {
    const u = await makeUser();
    const other = await signIn(u.email);
    if (!other.ok) throw new Error("sign-in failed");
    const result = await changePassword(u.viewer, PASSWORD, "a brand new passphrase", meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await validateSession(other.token)).toBeNull();
    expect(await validateSession(result.token)).toEqual(u.viewer);
    expect((await signIn(u.email, "a brand new passphrase")).ok).toBe(true);
    expect((await signIn(u.email, PASSWORD)).ok).toBe(false);
  });
});

describe("invites and resets", () => {
  it("only admins can invite", async () => {
    const treasurer = await makeUser("treasurer");
    await expect(inviteUser(treasurer.viewer, { email: "x@auth.test", role: "auditor", parishionerId: null }, meta)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inviteUser(null, { email: "y@auth.test", role: "auditor", parishionerId: null }, meta)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an invite link sets the password once and signs the user in", async () => {
    const email = `invitee-${randomUUID().slice(0, 8)}@auth.test`;
    const { token } = await inviteUser(admin, { email, role: "member", parishionerId }, meta);
    expect(await inspectToken(token)).toEqual({ status: "valid", email, purpose: "invite" });

    expect(await redeemToken(token, "short", meta)).toMatchObject({ ok: false, reason: "weak" });
    const redeemed = await redeemToken(token, "my own long passphrase", meta);
    expect(redeemed.ok).toBe(true);
    if (redeemed.ok) expect(await validateSession(redeemed.token)).toMatchObject({ role: "member", parishionerId });

    expect(await inspectToken(token)).toEqual({ status: "used" });
    expect(await redeemToken(token, "another long passphrase", meta)).toEqual({ ok: false, reason: "invalid" });
    expect((await signIn(email, "my own long passphrase")).ok).toBe(true);
  });

  it("stores only a hash of invite tokens", async () => {
    const { token, userId } = await inviteUser(admin, { email: `hash-${randomUUID().slice(0, 8)}@auth.test`, role: "auditor", parishionerId: null }, meta);
    const { rows } = await db.query("SELECT token_hash FROM user_tokens WHERE user_id = $1", [userId]);
    expect(rows[0].token_hash).toBe(sha256(token));
  });

  it("expired links don't work", async () => {
    // Token rows are immutable apart from used_at, so insert one that has already expired.
    const expired = "expired-token-for-test";
    const u = await makeUser("treasurer", null);
    await db.query(
      `INSERT INTO user_tokens (token_hash, user_id, purpose, created_at, expires_at)
       VALUES ($1, $2, 'invite', now() - interval '8 days', now() - interval '1 day')`,
      [sha256(expired), u.id],
    );
    expect(await inspectToken(expired)).toEqual({ status: "expired" });
    expect(await redeemToken(expired, "a perfectly good passphrase", meta)).toEqual({ ok: false, reason: "invalid" });
  });

  it("the database refuses to reuse or edit a token", async () => {
    const { token } = await inviteUser(admin, { email: `reuse-${randomUUID().slice(0, 8)}@auth.test`, role: "auditor", parishionerId: null }, meta);
    await redeemToken(token, "first and only passphrase", meta);
    await expect(db.query("UPDATE user_tokens SET used_at = NULL WHERE token_hash = $1", [sha256(token)])).rejects.toThrow(/single-use/);
    await expect(db.query("UPDATE user_tokens SET expires_at = now() + interval '1 year' WHERE token_hash = $1", [sha256(token)])).rejects.toThrow(/single-use/);
  });

  it("a reset link signs the user out everywhere", async () => {
    const u = await makeUser();
    const s = await signIn(u.email);
    if (!s.ok) throw new Error("sign-in failed");
    const { token } = await issuePasswordReset(admin, u.id, meta);
    expect(await validateSession(s.token)).toBeNull();
    expect(await inspectToken(token)).toMatchObject({ status: "valid", purpose: "password_reset" });
  });
});
