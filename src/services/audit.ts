import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { assertStaff, type Viewer } from "./viewer";

export type AuditEntry = {
  id: string;
  occurredAt: string; // Nairobi local, ISO without zone
  actor: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  isBackdated: boolean;
};

export const AUDIT_PAGE_SIZE = 30;

export async function listAuditLog(viewer: Viewer | null, f: { action?: string; entity?: string; backdated?: string; page: number }) {
  assertStaff(viewer);
  const where: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (f.action) where.push(Prisma.sql`a.action = ${f.action}`);
  if (f.entity) where.push(Prisma.sql`a.entity_type = ${f.entity}`);
  if (f.backdated === "yes") where.push(Prisma.sql`a.is_backdated`);
  const whereSql = Prisma.join(where, " AND ");

  const rows = await prisma.$queryRaw<
    {
      id: bigint;
      occurred_at: string;
      actor: string | null;
      actor_role: string | null;
      action: string;
      entity_type: string;
      entity_id: string | null;
      after_data: Record<string, unknown> | null;
      is_backdated: boolean;
    }[]
  >`
    SELECT a.id, to_char(a.occurred_at AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD"T"HH24:MI:SS') AS occurred_at,
           u.email AS actor, u.role::text AS actor_role, a.action, a.entity_type, a.entity_id, a.after_data, a.is_backdated
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE ${whereSql}
     ORDER BY a.id DESC
     LIMIT ${AUDIT_PAGE_SIZE} OFFSET ${(f.page - 1) * AUDIT_PAGE_SIZE}`;

  const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM audit_log a WHERE ${whereSql}`;
  const actions = await prisma.$queryRaw<{ action: string }[]>`SELECT DISTINCT action FROM audit_log ORDER BY action`;
  const entities = await prisma.$queryRaw<{ entity_type: string }[]>`SELECT DISTINCT entity_type FROM audit_log ORDER BY entity_type`;

  return {
    rows: rows.map(
      (r): AuditEntry => ({
        id: String(r.id),
        occurredAt: r.occurred_at,
        actor: r.actor,
        actorRole: r.actor_role,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        summary: summarise(r.after_data),
        isBackdated: r.is_backdated,
      }),
    ),
    total: n,
    actions: actions.map((a) => a.action),
    entities: entities.map((e) => e.entity_type),
  };
}

function summarise(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const parts: string[] = [];
  if (typeof data.kind === "string") parts.push(data.kind === "reversal" ? "Reversal" : "Payment");
  if (typeof data.amount_cents === "number") parts.push(`KSh ${(data.amount_cents / 100).toLocaleString("en-KE")}`);
  if (typeof data.source === "string") parts.push(`via ${data.source}`);
  return parts.length ? parts.join(" · ") : null;
}
