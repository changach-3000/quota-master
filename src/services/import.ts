import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { importSchema, type ImportInput, type ImportRow } from "@/schemas/import";
import { recordPayment } from "./payments";
import { ForbiddenError, type Viewer } from "./viewer";

// Committing an import. Every row goes through recordPayment, so imported
// payments obey exactly the same rules as typed ones (dates, periods,
// duplicate codes, audit, backdating). Rows are independent: a bad row is
// skipped with a reason and the rest still import.

type Meta = { ip: string | null; userAgent: string | null };

export type ImportResult =
  | {
      ok: true;
      imported: number;
      importedCents: number;
      alreadyImported: number;
      skipped: { line: number; reason: string }[];
    }
  | { ok: false; message: string };

/**
 * A row's idempotency key comes from its content, not its position, so
 * importing the same file twice (or a re-sorted copy) records nothing new.
 */
export function rowKey(row: Pick<ImportRow, "date" | "name" | "amountCents" | "method" | "reference">): string {
  const h = createHash("sha256")
    .update(["import-v1", row.date, row.name.trim().toLowerCase(), row.amountCents, row.method, row.reference.trim().toUpperCase()].join("|"))
    .digest("hex");
  // Shape as an RFC 9562 UUID (version 8, custom) so it fits the key format.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function importPayments(viewer: Viewer | null, input: ImportInput, meta: Meta, today: string): Promise<ImportResult> {
  if (!viewer || (viewer.role !== "treasurer" && viewer.role !== "admin")) throw new ForbiddenError("Only the treasurer or an admin can import");
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "The import file couldn't be read" };
  const { fileName, rows } = parsed.data;

  // Names are matched exactly (ignoring case) against active parishioners.
  const people = await prisma.$queryRaw<{ id: string; key: string }[]>`
    SELECT id, lower(display_name) AS key FROM parishioners WHERE is_active`;
  const byName = new Map<string, string[]>();
  for (const p of people) byName.set(p.key, [...(byName.get(p.key) ?? []), p.id]);

  let imported = 0;
  let importedCents = 0;
  let alreadyImported = 0;
  const skipped: { line: number; reason: string }[] = [];

  for (const row of rows) {
    const matches = byName.get(row.name.trim().toLowerCase()) ?? [];
    if (matches.length === 0) {
      skipped.push({ line: row.line, reason: `“${row.name}” isn't on the parishioner list. Add them first, then import again.` });
      continue;
    }
    if (matches.length > 1) {
      skipped.push({ line: row.line, reason: `More than one parishioner is called “${row.name}”. Record this one by hand.` });
      continue;
    }

    const result = await recordPayment(
      viewer,
      {
        parishionerId: matches[0],
        method: row.method,
        mpesaCode: row.method === "mpesa" ? row.reference : undefined,
        receiptNo: row.method === "cash" ? row.reference || `Imported line ${row.line}` : undefined,
        amount: (row.amountCents / 100).toFixed(2),
        receivedOn: row.date,
        notes: `Imported from ${fileName}, line ${row.line}`,
        idempotencyKey: rowKey(row),
      },
      meta,
      today,
    );

    if (result.ok) {
      if (result.replayed) alreadyImported++;
      else {
        imported++;
        importedCents += result.amount;
      }
      continue;
    }
    const e = result.error;
    skipped.push({
      line: row.line,
      reason:
        e.code === "duplicate_mpesa"
          ? `M-Pesa code ${row.reference} is already recorded${e.existing.parishioner ? ` for ${e.existing.parishioner}` : ""}.`
          : e.code === "invalid"
            ? (Object.values(e.fieldErrors).find(Boolean) ?? "Invalid row")
            : e.message,
    });
  }

  await prisma.$executeRaw`
    INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after_data, ip_address)
    VALUES (${viewer.userId}::uuid, 'import.committed', 'import', ${fileName},
            ${JSON.stringify({ file: fileName, rows: rows.length, imported, imported_cents: importedCents, already_imported: alreadyImported, skipped: skipped.length })}::jsonb,
            ${meta.ip}::inet)`;

  return { ok: true, imported, importedCents, alreadyImported, skipped };
}
