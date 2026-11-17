import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { yearSheetImportSchema, type YearSheetImportInput } from "@/schemas/year-sheet";
import { BACKDATED_AFTER_DAYS } from "./payments";
import { setPledge } from "./pledge-setting";
import { ForbiddenError, type Viewer } from "./viewer";

// Importing the treasurer's yearly sheet (one row per person). For each row:
//   1. find the parishioner in the chosen church by name, or add them;
//   2. set their pledge for the period from the QUOTA column (versioned);
//   3. record each instalment as a historical payment: no code or receipt
//      needed, never deposited, and dated either with a date the treasurer
//      entered or the "as at" date, flagged as estimated.
// Rows are independent; a bad row is skipped with a reason.

type Meta = { ip: string | null; userAgent: string | null };

export type YearSheetResult =
  | {
      ok: true;
      people: { matched: number; added: number };
      pledges: { set: number; unchanged: number };
      payments: { recorded: number; recordedCents: number; alreadyImported: number };
      skipped: { line: number; reason: string }[];
      notes: { line: number; note: string }[];
    }
  | { ok: false; message: string };

/** Deterministic UUID (RFC 9562 version 8) from content, for idempotency keys. */
export function contentKey(parts: (string | number)[]): string {
  const h = createHash("sha256").update(parts.join("|")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export async function importYearSheet(viewer: Viewer | null, input: YearSheetImportInput, meta: Meta, today: string): Promise<YearSheetResult> {
  if (!viewer || (viewer.role !== "treasurer" && viewer.role !== "admin")) throw new ForbiddenError("Only the treasurer or an admin can import");
  const parsed = yearSheetImportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "The sheet couldn't be read" };
  const { fileName, periodId, churchId, asOfDate, rows } = parsed.data;

  const [period] = await prisma.$queryRaw<{ name: string; starts_on: string; ends_on: string }[]>`
    SELECT name, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on
      FROM quota_periods WHERE id = ${periodId}::uuid`;
  if (!period) return { ok: false, message: "That quota period doesn't exist." };
  const [church] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM churches WHERE id = ${churchId}::uuid`;
  if (!church) return { ok: false, message: "That church doesn't exist." };
  const inPeriod = (d: string) => d >= period.starts_on && d <= period.ends_on && d <= today;
  if (!inPeriod(asOfDate)) return { ok: false, message: `The "as at" date must be inside the ${period.name} period and not in the future.` };

  const people = await prisma.$queryRaw<{ id: string; key: string }[]>`
    SELECT id, lower(display_name) AS key FROM parishioners WHERE is_active AND church_id = ${churchId}::uuid`;
  const byName = new Map<string, string[]>();
  for (const p of people) byName.set(p.key, [...(byName.get(p.key) ?? []), p.id]);

  const result = {
    people: { matched: 0, added: 0 },
    pledges: { set: 0, unchanged: 0 },
    payments: { recorded: 0, recordedCents: 0, alreadyImported: 0 },
    skipped: [] as { line: number; reason: string }[],
    notes: [] as { line: number; note: string }[],
  };

  for (const row of rows) {
    const bad = row.instalments.find((i) => i.date && !inPeriod(i.date));
    if (bad) {
      result.skipped.push({ line: row.line, reason: `A payment date (${bad.date}) is outside ${period.name} or in the future.` });
      continue;
    }

    // 1. The person.
    const key = row.name.toLowerCase();
    const matches = byName.get(key) ?? [];
    if (matches.length > 1) {
      result.skipped.push({ line: row.line, reason: `More than one parishioner is called “${row.name}”. Import this row by hand.` });
      continue;
    }
    let parishionerId = matches[0];
    if (parishionerId) {
      result.people.matched++;
    } else {
      parishionerId = await prisma.$transaction(async (tx) => {
        const [created] = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO parishioners (church_id, display_name) VALUES (${churchId}::uuid, ${row.name}) RETURNING id`;
        await tx.$executeRaw`
          INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after_data, ip_address)
          VALUES (${viewer.userId}::uuid, 'parishioner.created', 'parishioner', ${created.id},
                  ${JSON.stringify({ display_name: row.name, church_id: churchId, source: fileName })}::jsonb, ${meta.ip}::inet)`;
        return created.id;
      });
      byName.set(key, [parishionerId]);
      result.people.added++;
    }

    // 2. The pledge (QUOTA column), effective from the start of the period.
    if (row.quotaCents && row.quotaCents > 0) {
      const pledge = await setPledge(
        viewer,
        {
          parishionerId,
          periodId,
          amount: (row.quotaCents / 100).toFixed(2),
          effectiveFrom: period.starts_on,
          idempotencyKey: contentKey(["year-sheet-pledge-v1", periodId, key, row.quotaCents]),
        },
        meta,
      );
      if (pledge.ok) {
        if (pledge.replayed) result.pledges.unchanged++;
        else result.pledges.set++;
      } else if (pledge.error.code === "unchanged") {
        result.pledges.unchanged++;
      } else {
        result.notes.push({ line: row.line, note: `Pledge not changed: ${"message" in pledge.error ? pledge.error.message : "invalid amount"}` });
      }
    }

    // 3. The instalments, as historical payments.
    for (const [n, inst] of row.instalments.entries()) {
      const receivedOn = inst.date ?? asOfDate;
      const idempotencyKey = contentKey(["year-sheet-payment-v1", periodId, key, inst.column, inst.amountCents, inst.method]);
      await prisma.$transaction(async (tx) => {
        const [inserted] = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO contributions
            (kind, parishioner_id, period_id, amount_cents, method, received_on, idempotency_key, recorded_by, notes, is_historical, date_is_estimated)
          VALUES ('payment', ${parishionerId}::uuid, ${periodId}::uuid, ${inst.amountCents}, ${inst.method}::payment_method,
                  ${receivedOn}::date, ${idempotencyKey}, ${viewer.userId}::uuid,
                  ${`Imported from ${fileName}, row ${row.line}, payment ${n + 1}`}, true, ${inst.date === null})
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING id`;
        if (!inserted) {
          result.payments.alreadyImported++;
          return;
        }
        await tx.$executeRaw`
          INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after_data, is_backdated, ip_address)
          VALUES (${viewer.userId}::uuid, 'contribution.recorded', 'contribution', ${inserted.id},
                  ${JSON.stringify({ kind: "payment", amount_cents: inst.amountCents, method: inst.method, received_on: receivedOn, historical: true, date_is_estimated: inst.date === null, source: fileName })}::jsonb,
                  ${daysBetween(receivedOn, today) > BACKDATED_AFTER_DAYS}, ${meta.ip}::inet)`;
        result.payments.recorded++;
        result.payments.recordedCents += inst.amountCents;
      });
    }
  }

  await prisma.$executeRaw`
    INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after_data, ip_address)
    VALUES (${viewer.userId}::uuid, 'import.committed', 'import', ${fileName},
            ${JSON.stringify({ mode: "year_sheet", period: period.name, rows: rows.length, ...result.people, pledges_set: result.pledges.set, payments: result.payments.recorded, payments_cents: result.payments.recordedCents, skipped: result.skipped.length })}::jsonb,
            ${meta.ip}::inet)`;

  return { ok: true, ...result };
}
