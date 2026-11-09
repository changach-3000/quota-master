import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { recordPaymentSchema, reversePaymentSchema, type RecordPaymentInput, type ReversePaymentInput } from "@/schemas/contribution";
import { z } from "zod";
import { ForbiddenError, type Viewer } from "./viewer";

// Writing to the ledger (handoff §8): validate, authorise, then ONE
// transaction that inserts the contribution and its audit row, and returns the
// balance as the database derives it. The client never computes balances.

type Meta = { ip: string | null; userAgent: string | null };

/** Entries older than this are flagged as backdated in the audit log (business rule 7). */
export const BACKDATED_AFTER_DAYS = 7;

export type Balance = { pledged: number; received: number; outstanding: number; credit: number };

export type PaymentError =
  | { code: "invalid"; fieldErrors: Record<string, string | undefined> }
  | { code: "no_period" | "future_date" | "unknown_parishioner" | "idempotency_conflict" | "not_found" | "already_reversed" | "not_reversible"; message: string }
  | { code: "duplicate_mpesa"; message: string; existing: { parishioner: string; receivedOn: string } };

export type RecordResult =
  | { ok: true; contributionId: string; replayed: boolean; parishioner: string; amount: number; balance: Balance; period: string; backdated: boolean }
  | { ok: false; error: PaymentError };

export type ReverseResult = { ok: true; reversalId: string; replayed: boolean; balance: Balance } | { ok: false; error: PaymentError };

function assertCanWrite(viewer: Viewer | null): asserts viewer is Viewer {
  if (!viewer || (viewer.role !== "treasurer" && viewer.role !== "admin")) throw new ForbiddenError("Only the treasurer or an admin can change the ledger");
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

type Tx = Prisma.TransactionClient;

async function balanceOf(tx: Tx, parishionerId: string, periodId: string): Promise<Balance> {
  const [b] = await tx.$queryRaw<{ pledged_cents: bigint; received_cents: bigint; outstanding_cents: bigint; credit_cents: bigint }[]>`
    SELECT pledged_cents, received_cents, outstanding_cents, credit_cents
      FROM parishioner_balances WHERE parishioner_id = ${parishionerId}::uuid AND period_id = ${periodId}::uuid`;
  return {
    pledged: Number(b?.pledged_cents ?? 0),
    received: Number(b?.received_cents ?? 0),
    outstanding: Number(b?.outstanding_cents ?? 0),
    credit: Number(b?.credit_cents ?? 0),
  };
}

function uniqueViolation(err: unknown): string | null {
  // Prisma surfaces unique violations from raw queries as P2010 with the pg error inside.
  const text = err instanceof Error ? err.message : String(err);
  const match = text.match(/(contributions_[a-z_]+_key)/);
  return /23505|unique/i.test(text) && match ? match[1] : null;
}

/**
 * Records one payment. Safe to retry: the same idempotency key with the same
 * details returns the original payment instead of creating a second one.
 * `today` is the parish's current date (Africa/Nairobi), passed in for testability.
 */
export async function recordPayment(viewer: Viewer | null, input: RecordPaymentInput, meta: Meta, today: string): Promise<RecordResult> {
  assertCanWrite(viewer);
  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) {
    const fe = z.flattenError(parsed.error).fieldErrors;
    return { ok: false, error: { code: "invalid", fieldErrors: Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0]])) } };
  }
  const p = parsed.data;
  if (p.receivedOn > today) return { ok: false, error: { code: "future_date", message: "The date received can't be in the future." } };

  const [period] = await prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT id, name FROM quota_periods WHERE ${p.receivedOn}::date BETWEEN starts_on AND ends_on`;
  if (!period) return { ok: false, error: { code: "no_period", message: "No quota period covers that date. Add one in Settings first." } };

  const [person] = await prisma.$queryRaw<{ name: string }[]>`
    SELECT display_name AS name FROM parishioners WHERE id = ${p.parishionerId}::uuid AND is_active`;
  if (!person) return { ok: false, error: { code: "unknown_parishioner", message: "That parishioner isn't on the active list." } };

  const backdated = daysBetween(p.receivedOn, today) > BACKDATED_AFTER_DAYS;
  const mpesaCode = p.method === "mpesa" ? p.mpesaCode! : null;
  const receiptNo = p.method === "cash" ? p.receiptNo! : null;

  try {
    return await prisma.$transaction(async (tx) => {
      // ON CONFLICT on the idempotency key turns a retry into a no-op instead of an error.
      const [inserted] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO contributions
          (kind, parishioner_id, period_id, amount_cents, method, mpesa_code, receipt_no, received_on, idempotency_key, recorded_by, notes)
        VALUES ('payment', ${p.parishionerId}::uuid, ${period.id}::uuid, ${p.amount}, ${p.method}::payment_method,
                ${mpesaCode}, ${receiptNo}, ${p.receivedOn}::date, ${p.idempotencyKey}, ${viewer.userId}::uuid, ${p.notes ?? null})
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id`;

      if (!inserted) {
        const [existing] = await tx.$queryRaw<{ id: string; parishioner_id: string; amount_cents: bigint; mpesa_code: string | null; receipt_no: string | null; period_id: string }[]>`
          SELECT id, parishioner_id, amount_cents, mpesa_code, receipt_no, period_id FROM contributions WHERE idempotency_key = ${p.idempotencyKey}`;
        const same =
          existing &&
          existing.parishioner_id === p.parishionerId &&
          Number(existing.amount_cents) === p.amount &&
          existing.mpesa_code === mpesaCode &&
          existing.receipt_no === receiptNo;
        if (!same) {
          return { ok: false as const, error: { code: "idempotency_conflict" as const, message: "This form was already used for a different payment. Reload the page and try again." } };
        }
        return {
          ok: true as const,
          contributionId: existing.id,
          replayed: true,
          parishioner: person.name,
          amount: p.amount,
          balance: await balanceOf(tx, p.parishionerId, existing.period_id),
          period: period.name,
          backdated,
        };
      }

      await tx.$executeRaw`
        INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after_data, is_backdated, ip_address)
        VALUES (${viewer.userId}::uuid, 'contribution.recorded', 'contribution', ${inserted.id},
                ${JSON.stringify({ kind: "payment", amount_cents: p.amount, method: p.method, mpesa_code: mpesaCode, receipt_no: receiptNo, received_on: p.receivedOn, parishioner_id: p.parishionerId })}::jsonb,
                ${backdated}, ${meta.ip}::inet)`;

      return {
        ok: true as const,
        contributionId: inserted.id,
        replayed: false,
        parishioner: person.name,
        amount: p.amount,
        balance: await balanceOf(tx, p.parishionerId, period.id),
        period: period.name,
        backdated,
      };
    });
  } catch (err) {
    if (uniqueViolation(err) === "contributions_mpesa_code_key" && mpesaCode) {
      const [dup] = await prisma.$queryRaw<{ parishioner: string; received_on: string }[]>`
        SELECT pa.display_name AS parishioner, to_char(c.received_on, 'YYYY-MM-DD') AS received_on
          FROM contributions c JOIN parishioners pa ON pa.id = c.parishioner_id WHERE c.mpesa_code = ${mpesaCode}`;
      return {
        ok: false,
        error: {
          code: "duplicate_mpesa",
          message: "This M-Pesa code has already been recorded.",
          existing: { parishioner: dup?.parishioner ?? "another parishioner", receivedOn: dup?.received_on ?? "" },
        },
      };
    }
    throw err;
  }
}

/**
 * Reverses a payment: inserts a matching reversal (same parishioner, period
 * and amount, enforced by the database) with a reason. The original stays.
 */
export async function reversePayment(viewer: Viewer | null, input: ReversePaymentInput, meta: Meta, today: string): Promise<ReverseResult> {
  assertCanWrite(viewer);
  const parsed = reversePaymentSchema.safeParse(input);
  if (!parsed.success) {
    const fe = z.flattenError(parsed.error).fieldErrors;
    return { ok: false, error: { code: "invalid", fieldErrors: Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0]])) } };
  }
  const r = parsed.data;

  const [original] = await prisma.$queryRaw<
    { id: string; kind: string; parishioner_id: string; period_id: string; amount_cents: bigint; received_on: string; deposited: boolean; reversal_id: string | null }[]
  >`
    SELECT c.id, c.kind, c.parishioner_id, c.period_id, c.amount_cents, to_char(c.received_on, 'YYYY-MM-DD') AS received_on,
           EXISTS (SELECT 1 FROM deposit_items di WHERE di.contribution_id = c.id) AS deposited,
           (SELECT x.id FROM contributions x WHERE x.reverses_id = c.id) AS reversal_id
      FROM contributions c WHERE c.id = ${r.contributionId}::uuid`;
  if (!original) return { ok: false, error: { code: "not_found", message: "That payment doesn't exist." } };
  if (original.kind !== "payment") return { ok: false, error: { code: "not_reversible", message: "A reversal can't itself be reversed. Record a new payment instead." } };

  // A reversal is dated today, but never before the payment it corrects.
  const reversedOn = today < original.received_on ? original.received_on : today;

  try {
    return await prisma.$transaction(async (tx) => {
      const [inserted] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO contributions (kind, parishioner_id, period_id, amount_cents, received_on, reverses_id, reason, idempotency_key, recorded_by)
        VALUES ('reversal', ${original.parishioner_id}::uuid, ${original.period_id}::uuid, ${original.amount_cents},
                ${reversedOn}::date, ${original.id}::uuid, ${r.reason}, ${r.idempotencyKey}, ${viewer.userId}::uuid)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id`;

      if (!inserted) {
        const [existing] = await tx.$queryRaw<{ id: string; reverses_id: string | null }[]>`
          SELECT id, reverses_id FROM contributions WHERE idempotency_key = ${r.idempotencyKey}`;
        if (existing?.reverses_id !== original.id) {
          return { ok: false as const, error: { code: "idempotency_conflict" as const, message: "This form was already used. Reload the page and try again." } };
        }
        return { ok: true as const, reversalId: existing.id, replayed: true, balance: await balanceOf(tx, original.parishioner_id, original.period_id) };
      }

      await tx.$executeRaw`
        INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, before_data, after_data, ip_address)
        VALUES (${viewer.userId}::uuid, 'contribution.reversed', 'contribution', ${inserted.id},
                ${JSON.stringify({ contribution_id: original.id, amount_cents: Number(original.amount_cents), received_on: original.received_on, deposited: original.deposited })}::jsonb,
                ${JSON.stringify({ kind: "reversal", amount_cents: Number(original.amount_cents), reason: r.reason })}::jsonb,
                ${meta.ip}::inet)`;

      return { ok: true as const, reversalId: inserted.id, replayed: false, balance: await balanceOf(tx, original.parishioner_id, original.period_id) };
    });
  } catch (err) {
    if (uniqueViolation(err) === "contributions_reverses_id_key") {
      return { ok: false, error: { code: "already_reversed", message: "This payment has already been reversed." } };
    }
    throw err;
  }
}
