import "server-only";
import { prisma } from "@/lib/db";
import {
  churchSchema,
  kenyanPhone,
  parishionerSchema,
  periodSchema,
  quotasSchema,
  type ChurchInput,
  type ParishionerInput,
  type PeriodInput,
  type QuotasInput,
} from "@/schemas/settings";
import { z } from "zod";
import { ForbiddenError, ownParishionerId, type Viewer } from "./viewer";

// Parish set-up: quotas, periods, churches and parishioners, plus a member's
// own phone number. Every change is written with an audit row in the same
// transaction. The database enforces uniqueness and non-overlapping periods;
// these functions turn its refusals into plain messages.

type Meta = { ip: string | null; userAgent: string | null };
export type WriteResult<T = object> = ({ ok: true } & T) | { ok: false; fieldErrors?: Record<string, string | undefined>; message?: string };

function assertCanWrite(viewer: Viewer | null): asserts viewer is Viewer {
  if (!viewer || (viewer.role !== "treasurer" && viewer.role !== "admin")) throw new ForbiddenError("Only the treasurer or an admin can change parish set-up");
}

const invalid = (err: z.ZodError) => ({
  ok: false as const,
  fieldErrors: Object.fromEntries(Object.entries(z.flattenError(err).fieldErrors).map(([k, v]) => [k, (v as string[] | undefined)?.[0]])),
});

const dbError = (err: unknown) => (err instanceof Error ? err.message : String(err));

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
async function audit(tx: Tx, viewer: Viewer, action: string, entityType: string, entityId: string, before: unknown, after: unknown, meta: Meta) {
  await tx.$executeRaw`
    INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, before_data, after_data, ip_address)
    VALUES (${viewer.userId}::uuid, ${action}, ${entityType}, ${entityId},
            ${before === null ? null : JSON.stringify(before)}::jsonb, ${JSON.stringify(after)}::jsonb, ${meta.ip}::inet)`;
}

/** Sets church quotas for one period. Only the churches listed change. */
export async function saveQuotas(viewer: Viewer | null, input: QuotasInput, meta: Meta): Promise<WriteResult<{ changed: number }>> {
  assertCanWrite(viewer);
  const parsed = quotasSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { periodId, quotas } = parsed.data;

  const [period] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM quota_periods WHERE id = ${periodId}::uuid`;
  if (!period) return { ok: false, message: "That quota period doesn't exist." };

  return prisma.$transaction(async (tx) => {
    let changed = 0;
    for (const q of quotas) {
      const [before] = await tx.$queryRaw<{ amount_cents: bigint }[]>`
        SELECT amount_cents FROM church_quotas WHERE church_id = ${q.churchId}::uuid AND period_id = ${periodId}::uuid FOR UPDATE`;
      if (before && Number(before.amount_cents) === q.amount) continue;
      await tx.$executeRaw`
        INSERT INTO church_quotas (church_id, period_id, amount_cents) VALUES (${q.churchId}::uuid, ${periodId}::uuid, ${q.amount})
        ON CONFLICT (church_id, period_id) DO UPDATE SET amount_cents = EXCLUDED.amount_cents`;
      await audit(tx, viewer, "quota.set", "church_quota", `${q.churchId}:${periodId}`, before ? { amount_cents: Number(before.amount_cents) } : null, { amount_cents: q.amount }, meta);
      changed++;
    }
    return { ok: true as const, changed };
  });
}

export async function addPeriod(viewer: Viewer | null, input: PeriodInput, meta: Meta): Promise<WriteResult<{ id: string }>> {
  assertCanWrite(viewer);
  const parsed = periodSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  try {
    return await prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO quota_periods (name, starts_on, ends_on) VALUES (${v.name}, ${v.startsOn}::date, ${v.endsOn}::date) RETURNING id`;
      await audit(tx, viewer, "period.created", "quota_period", row.id, null, v, meta);
      return { ok: true as const, id: row.id };
    });
  } catch (err) {
    const text = dbError(err);
    if (/quota_periods_no_overlap/.test(text)) return { ok: false, fieldErrors: { startsOn: "These dates overlap an existing period." } };
    if (/quota_periods_name_key/.test(text)) return { ok: false, fieldErrors: { name: "A period with that name already exists." } };
    throw err;
  }
}

export async function addChurch(viewer: Viewer | null, input: ChurchInput, meta: Meta): Promise<WriteResult<{ id: string }>> {
  assertCanWrite(viewer);
  const parsed = churchSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    return await prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string }[]>`INSERT INTO churches (name) VALUES (${parsed.data.name}) RETURNING id`;
      await audit(tx, viewer, "church.created", "church", row.id, null, parsed.data, meta);
      return { ok: true as const, id: row.id };
    });
  } catch (err) {
    if (/churches_name_key/.test(dbError(err))) return { ok: false, fieldErrors: { name: "A church with that name already exists." } };
    throw err;
  }
}

export async function addParishioner(viewer: Viewer | null, input: ParishionerInput, meta: Meta): Promise<WriteResult<{ id: string; name: string }>> {
  assertCanWrite(viewer);
  const parsed = parishionerSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  const [church] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM churches WHERE id = ${v.churchId}::uuid`;
  if (!church) return { ok: false, fieldErrors: { churchId: "Choose their church" } };

  return prisma.$transaction(async (tx) => {
    let householdId: string | null = null;
    if (v.household) {
      // Households are per church; reuse an existing label instead of duplicating it.
      const [h] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO households (church_id, label) VALUES (${v.churchId}::uuid, ${v.household})
        ON CONFLICT (church_id, label) DO UPDATE SET label = EXCLUDED.label
        RETURNING id`;
      householdId = h.id;
    }
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO parishioners (church_id, household_id, display_name, phone)
      VALUES (${v.churchId}::uuid, ${householdId}::uuid, ${v.displayName}, ${v.phone ?? null})
      RETURNING id`;
    await audit(tx, viewer, "parishioner.created", "parishioner", row.id, null, { display_name: v.displayName, church_id: v.churchId, household: v.household ?? null }, meta);
    return { ok: true as const, id: row.id, name: v.displayName };
  });
}

/** A member updating the phone number on their own record. Nobody else's. */
export async function updateMyPhone(viewer: Viewer | null, phone: string, meta: Meta): Promise<WriteResult<{ phone: string | null }>> {
  const parishionerId = ownParishionerId(viewer);
  const parsed = kenyanPhone.safeParse(phone);
  if (!parsed.success) return { ok: false, fieldErrors: { phone: parsed.error.issues[0]?.message } };

  return prisma.$transaction(async (tx) => {
    const [before] = await tx.$queryRaw<{ phone: string | null }[]>`SELECT phone FROM parishioners WHERE id = ${parishionerId}::uuid FOR UPDATE`;
    await tx.$executeRaw`UPDATE parishioners SET phone = ${parsed.data} WHERE id = ${parishionerId}::uuid`;
    // Phone numbers are personal data: the audit row records that it changed, not the numbers.
    await audit(tx, viewer!, "parishioner.phone_changed", "parishioner", parishionerId, { had_phone: !!before?.phone }, { has_phone: !!parsed.data }, meta);
    return { ok: true as const, phone: parsed.data };
  });
}
