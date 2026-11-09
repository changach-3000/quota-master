import "server-only";
import { prisma } from "@/lib/db";
import { setPledgeSchema, type SetPledgeInput } from "@/schemas/pledge";
import { z } from "zod";
import { ForbiddenError, type Viewer } from "./viewer";

// Pledges are versioned (business rule 5): a change retires the current
// version and inserts version N+1 with an effective date, so reports run for
// an earlier date stay reproducible. The database allows only one current
// version per person and period and refuses edits to old versions.

type Meta = { ip: string | null; userAgent: string | null };

export type PledgeError =
  | { code: "invalid"; fieldErrors: Record<string, string | undefined> }
  | { code: "unknown_parishioner" | "unknown_period" | "outside_period" | "before_current" | "unchanged" | "idempotency_conflict"; message: string };

export type PledgeResult =
  | { ok: true; pledgeId: string; version: number; amount: number; replayed: boolean; outstanding: number; credit: number }
  | { ok: false; error: PledgeError };

export async function setPledge(viewer: Viewer | null, input: SetPledgeInput, meta: Meta): Promise<PledgeResult> {
  if (!viewer || (viewer.role !== "treasurer" && viewer.role !== "admin")) throw new ForbiddenError("Only the treasurer or an admin can set pledges");

  const parsed = setPledgeSchema.safeParse(input);
  if (!parsed.success) {
    const fe = z.flattenError(parsed.error).fieldErrors;
    return { ok: false, error: { code: "invalid", fieldErrors: Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0]])) } };
  }
  const p = parsed.data;

  const [period] = await prisma.$queryRaw<{ starts_on: string; ends_on: string }[]>`
    SELECT to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on
      FROM quota_periods WHERE id = ${p.periodId}::uuid`;
  if (!period) return { ok: false, error: { code: "unknown_period", message: "That quota period doesn't exist." } };
  if (p.effectiveFrom < period.starts_on || p.effectiveFrom > period.ends_on) {
    return { ok: false, error: { code: "outside_period", message: "The effective date must fall inside the quota period." } };
  }

  return prisma.$transaction(async (tx) => {
    // Serialise pledge changes for this person: concurrent edits queue here.
    const [person] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM parishioners WHERE id = ${p.parishionerId}::uuid AND is_active FOR UPDATE`;
    if (!person) return { ok: false as const, error: { code: "unknown_parishioner" as const, message: "That parishioner isn't on the active list." } };

    const balance = async () => {
      const [b] = await tx.$queryRaw<{ outstanding_cents: bigint; credit_cents: bigint }[]>`
        SELECT outstanding_cents, credit_cents FROM parishioner_balances
         WHERE parishioner_id = ${p.parishionerId}::uuid AND period_id = ${p.periodId}::uuid`;
      return { outstanding: Number(b?.outstanding_cents ?? 0), credit: Number(b?.credit_cents ?? 0) };
    };

    const [replay] = await tx.$queryRaw<{ id: string; version: number; amount_cents: bigint; parishioner_id: string }[]>`
      SELECT id, version, amount_cents, parishioner_id FROM pledges WHERE idempotency_key = ${p.idempotencyKey}`;
    if (replay) {
      if (replay.parishioner_id !== p.parishionerId || Number(replay.amount_cents) !== p.amount) {
        return { ok: false as const, error: { code: "idempotency_conflict" as const, message: "This form was already used for a different pledge. Reload and try again." } };
      }
      return { ok: true as const, pledgeId: replay.id, version: replay.version, amount: p.amount, replayed: true, ...(await balance()) };
    }

    const [current] = await tx.$queryRaw<{ id: string; version: number; amount_cents: bigint; effective_from: string }[]>`
      SELECT id, version, amount_cents, to_char(effective_from, 'YYYY-MM-DD') AS effective_from
        FROM pledges WHERE parishioner_id = ${p.parishionerId}::uuid AND period_id = ${p.periodId}::uuid AND is_current`;
    if (current && Number(current.amount_cents) === p.amount) {
      return { ok: false as const, error: { code: "unchanged" as const, message: "That is already their pledge." } };
    }
    if (current && p.effectiveFrom < current.effective_from) {
      return { ok: false as const, error: { code: "before_current" as const, message: "A change can't take effect before the current pledge does." } };
    }

    const [{ next }] = await tx.$queryRaw<{ next: number }[]>`
      SELECT COALESCE(max(version), 0) + 1 AS next FROM pledges
       WHERE parishioner_id = ${p.parishionerId}::uuid AND period_id = ${p.periodId}::uuid`;

    if (current) await tx.$executeRaw`UPDATE pledges SET is_current = false WHERE id = ${current.id}::uuid`;
    const [created] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO pledges (parishioner_id, period_id, amount_cents, version, effective_from, is_current, supersedes_id, created_by, idempotency_key)
      VALUES (${p.parishionerId}::uuid, ${p.periodId}::uuid, ${p.amount}, ${next}, ${p.effectiveFrom}::date, true,
              ${current?.id ?? null}::uuid, ${viewer.userId}::uuid, ${p.idempotencyKey})
      RETURNING id`;

    await tx.$executeRaw`
      INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, before_data, after_data, ip_address)
      VALUES (${viewer.userId}::uuid, 'pledge.set', 'pledge', ${created.id},
              ${current ? JSON.stringify({ version: current.version, amount_cents: Number(current.amount_cents) }) : null}::jsonb,
              ${JSON.stringify({ version: next, amount_cents: p.amount, effective_from: p.effectiveFrom, parishioner_id: p.parishionerId })}::jsonb,
              ${meta.ip}::inet)`;

    return { ok: true as const, pledgeId: created.id, version: next, amount: p.amount, replayed: false, ...(await balance()) };
  });
}
