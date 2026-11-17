import "server-only";
import { prisma } from "@/lib/db";
import { recordDepositSchema, type RecordDepositInput } from "@/schemas/deposit";
import { z } from "zod";
import { BACKDATED_AFTER_DAYS } from "./payments";
import { ForbiddenError, type Viewer } from "./viewer";

// Banking received money. The deposit amount is always the server's own sum
// of the selected payments; the slip amount the treasurer types is only a
// check against it. The database re-checks the total at COMMIT and refuses
// a payment that is already in another deposit.

type Meta = { ip: string | null; userAgent: string | null };

export type DepositError =
  | { code: "invalid"; fieldErrors: Record<string, string | undefined> }
  | { code: "mismatch"; message: string; selectedTotal: number }
  | { code: "not_depositable" | "already_deposited" | "future_date" | "before_received" | "idempotency_conflict"; message: string };

export type DepositResult = { ok: true; depositId: string; amount: number; items: number; replayed: boolean } | { ok: false; error: DepositError };

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export async function recordDeposit(viewer: Viewer | null, input: RecordDepositInput, meta: Meta, today: string): Promise<DepositResult> {
  if (!viewer || (viewer.role !== "treasurer" && viewer.role !== "admin")) throw new ForbiddenError("Only the treasurer or an admin can record deposits");

  const parsed = recordDepositSchema.safeParse(input);
  if (!parsed.success) {
    const fe = z.flattenError(parsed.error).fieldErrors;
    return { ok: false, error: { code: "invalid", fieldErrors: Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0]])) } };
  }
  const d = parsed.data;
  if (d.depositedOn > today) return { ok: false, error: { code: "future_date", message: "The date banked can't be in the future." } };

  // A retry of a deposit that already went through: answer with the original.
  const [prior] = await prisma.$queryRaw<{ id: string; amount_cents: bigint; items: number; ids: string[] }[]>`
    SELECT d.id, d.amount_cents, COUNT(di.contribution_id)::int AS items, array_agg(di.contribution_id::text) AS ids
      FROM deposits d LEFT JOIN deposit_items di ON di.deposit_id = d.id
     WHERE d.idempotency_key = ${d.idempotencyKey}
     GROUP BY d.id`;
  if (prior) {
    const same = prior.ids.length === d.contributionIds.length && d.contributionIds.every((id) => prior.ids.includes(id));
    return same
      ? { ok: true, depositId: prior.id, amount: Number(prior.amount_cents), items: prior.items, replayed: true }
      : { ok: false, error: { code: "idempotency_conflict", message: "This form was already used for a different deposit. Reload the page and try again." } };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string; kind: string; amount_cents: bigint; received_on: string; reversed: boolean; deposited: boolean; is_historical: boolean }[]
      >`
        SELECT c.id, c.kind, c.amount_cents, c.is_historical, to_char(c.received_on, 'YYYY-MM-DD') AS received_on,
               EXISTS (SELECT 1 FROM contributions r WHERE r.reverses_id = c.id) AS reversed,
               EXISTS (SELECT 1 FROM deposit_items di WHERE di.contribution_id = c.id) AS deposited
          FROM contributions c
         WHERE c.id = ANY(${d.contributionIds}::uuid[])`;

      if (rows.length !== d.contributionIds.length || rows.some((r) => r.kind !== "payment" || r.reversed || r.is_historical)) {
        return {
          ok: false as const,
          error: { code: "not_depositable" as const, message: "Some selected entries can't be deposited (reversed, or not a payment). Reload the page and select again." },
        };
      }
      if (rows.some((r) => r.deposited)) {
        return { ok: false as const, error: { code: "already_deposited" as const, message: "Some selected payments are already in a deposit. Reload the page to see what is still waiting." } };
      }
      const latest = rows.reduce((max, r) => (r.received_on > max ? r.received_on : max), "");
      if (d.depositedOn < latest) {
        return { ok: false as const, error: { code: "before_received" as const, message: "The date banked is before some of these payments were received." } };
      }

      const total = rows.reduce((s, r) => s + Number(r.amount_cents), 0);
      if (total !== d.slipAmount) {
        return {
          ok: false as const,
          error: { code: "mismatch" as const, message: "The slip amount doesn't match the selected payments.", selectedTotal: total },
        };
      }

      const [deposit] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO deposits (deposited_on, amount_cents, bank_ref, recorded_by, idempotency_key)
        VALUES (${d.depositedOn}::date, ${total}, ${d.bankRef || null}, ${viewer.userId}::uuid, ${d.idempotencyKey})
        RETURNING id`;
      await tx.$executeRaw`
        INSERT INTO deposit_items (deposit_id, contribution_id)
        SELECT ${deposit.id}::uuid, unnest(${d.contributionIds}::uuid[])`;
      await tx.$executeRaw`
        INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after_data, is_backdated, ip_address)
        VALUES (${viewer.userId}::uuid, 'deposit.recorded', 'deposit', ${deposit.id},
                ${JSON.stringify({ amount_cents: total, items: rows.length, deposited_on: d.depositedOn, bank_ref: d.bankRef || null })}::jsonb,
                ${daysBetween(d.depositedOn, today) > BACKDATED_AFTER_DAYS}, ${meta.ip}::inet)`;

      return { ok: true as const, depositId: deposit.id, amount: total, items: rows.length, replayed: false };
    });
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    // Lost a race: another deposit took one of these payments first, or the same key was used concurrently.
    if (/deposit_items_contribution_key/.test(text)) {
      return { ok: false, error: { code: "already_deposited", message: "Some selected payments were just deposited elsewhere. Reload the page to see what is still waiting." } };
    }
    if (/deposits_idempotency_key_key/.test(text)) return recordDeposit(viewer, input, meta, today);
    throw err;
  }
}
