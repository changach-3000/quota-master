import "server-only";
import { prisma } from "@/lib/db";
import { assertStaff, type Role, type Viewer } from "./viewer";

/** Churches with their quota for each period, plus member counts. */
export async function getParishSetup(viewer: Viewer | null) {
  assertStaff(viewer);
  const periods = await prisma.$queryRaw<{ id: string; name: string; starts_on: string; ends_on: string }[]>`
    SELECT id, name, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on
      FROM quota_periods ORDER BY starts_on DESC`;
  const churches = await prisma.$queryRaw<{ id: string; name: string; members: number }[]>`
    SELECT ch.id, ch.name, (SELECT COUNT(*)::int FROM parishioners pa WHERE pa.church_id = ch.id AND pa.is_active) AS members
      FROM churches ch ORDER BY ch.name`;
  const quotas = await prisma.$queryRaw<{ church_id: string; period_id: string; amount_cents: bigint }[]>`
    SELECT church_id, period_id, amount_cents FROM church_quotas`;
  return {
    periods: periods.map((p) => ({ id: p.id, name: p.name, startsOn: p.starts_on, endsOn: p.ends_on })),
    churches: churches.map((c) => ({
      id: c.id,
      name: c.name,
      members: c.members,
      quotas: Object.fromEntries(quotas.filter((q) => q.church_id === c.id).map((q) => [q.period_id, Number(q.amount_cents)])),
    })),
  };
}

export async function listUsers(viewer: Viewer | null) {
  assertStaff(viewer);
  const rows = await prisma.$queryRaw<
    { id: string; email: string; role: Role; is_active: boolean; parishioner: string | null; has_password: boolean; created_at: string }[]
  >`
    SELECT u.id, u.email, u.role, u.is_active, pa.display_name AS parishioner,
           (u.password_hash IS NOT NULL) AS has_password, to_char(u.created_at, 'YYYY-MM-DD') AS created_at
      FROM users u LEFT JOIN parishioners pa ON pa.id = u.parishioner_id
     ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'treasurer' THEN 1 WHEN 'auditor' THEN 2 ELSE 3 END, u.email`;
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    isActive: r.is_active,
    parishioner: r.parishioner,
    invitePending: !r.has_password,
    createdAt: r.created_at,
  }));
}

/** Parishioners who don't have a login yet, for the member invite picker. */
export async function listUnlinkedParishioners(viewer: Viewer | null) {
  assertStaff(viewer);
  return prisma.$queryRaw<{ id: string; name: string; church: string }[]>`
    SELECT pa.id, pa.display_name AS name, ch.name AS church
      FROM parishioners pa JOIN churches ch ON ch.id = pa.church_id
     WHERE pa.is_active AND NOT EXISTS (SELECT 1 FROM users u WHERE u.parishioner_id = pa.id)
     ORDER BY pa.display_name`;
}
