// Committing imports against the test database (2023 period, `today` fixed
// in mid-2023, apart from the other test files' periods).
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ImportRow } from "@/schemas/import";
import { importPayments, rowKey } from "@/services/import";
import { ForbiddenError, type Viewer } from "@/services/viewer";
import { testDatabaseUrl } from "../db/global-setup";

const db = new Client({ connectionString: testDatabaseUrl() });
const meta = { ip: null, userAgent: "vitest" };
const TODAY = "2023-06-15";

let treasurer: Viewer;
let auditor: Viewer;
let names: string[];
let seq = 0;

const code = () => `IMP${String(++seq).padStart(7, "0")}`;
const row = (overrides: Partial<ImportRow> = {}): ImportRow => ({
  line: ++seq + 1,
  date: "2023-06-01",
  name: names[0],
  amountCents: 250_000,
  method: "mpesa",
  reference: code(),
  ...overrides,
});

async function count(sql: string, params: unknown[] = []) {
  return (await db.query(sql, params)).rows[0].n as number;
}

beforeAll(async () => {
  await db.connect();
  await db.query(`INSERT INTO quota_periods (name, starts_on, ends_on) VALUES ('2023', '2023-01-01', '2023-12-31')`);
  const church = (await db.query(`INSERT INTO churches (name) VALUES ($1) RETURNING id`, [`Import Church ${randomUUID().slice(0, 6)}`])).rows[0].id;
  names = [];
  for (const n of ["Import Alpha", "Import Bravo", "Import Twin", "Import Twin"]) {
    await db.query(`INSERT INTO parishioners (church_id, display_name) VALUES ($1, $2)`, [church, n]);
    names.push(n);
  }
  const mk = async (role: string) => (await db.query(`INSERT INTO users (email, role) VALUES ($1, $2) RETURNING id`, [`${role}-${randomUUID().slice(0, 6)}@import.test`, role])).rows[0].id;
  treasurer = { userId: await mk("treasurer"), role: "treasurer", parishionerId: null };
  auditor = { userId: await mk("auditor"), role: "auditor", parishionerId: null };
});

afterAll(async () => {
  await db.end();
});

describe("importPayments", () => {
  it("only the treasurer or an admin can import", async () => {
    await expect(importPayments(auditor, { fileName: "x.csv", rows: [row()] }, meta, TODAY)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(importPayments(null, { fileName: "x.csv", rows: [row()] }, meta, TODAY)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("records good rows as normal payments, noting the file and line", async () => {
    const rows = [row({ amountCents: 100_000 }), row({ name: "import bravo", method: "cash", reference: "R-IMP-1", amountCents: 50_000 })];
    const result = await importPayments(treasurer, { fileName: "june.csv", rows }, meta, TODAY);
    expect(result).toEqual({ ok: true, imported: 2, importedCents: 150_000, alreadyImported: 0, skipped: [] });
    expect(await count(`SELECT COUNT(*)::int AS n FROM contributions WHERE notes = $1`, [`Imported from june.csv, line ${rows[0].line}`])).toBe(1);
    expect(await count(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'contribution.recorded' AND entity_id IN (SELECT id::text FROM contributions WHERE notes LIKE 'Imported from june.csv%')`)).toBe(2);
    const summary = await db.query(`SELECT after_data FROM audit_log WHERE action = 'import.committed' AND entity_id = 'june.csv'`);
    expect(summary.rows[0].after_data).toMatchObject({ rows: 2, imported: 2, skipped: 0 });
  });

  it("importing the same file again records nothing new", async () => {
    const rows = [row(), row({ method: "cash", reference: "R-IMP-2" })];
    const first = await importPayments(treasurer, { fileName: "twice.csv", rows }, meta, TODAY);
    const reordered = [{ ...rows[1], line: 2 }, { ...rows[0], line: 3 }];
    const second = await importPayments(treasurer, { fileName: "twice-copy.csv", rows: reordered }, meta, TODAY);
    expect(first).toMatchObject({ imported: 2, alreadyImported: 0 });
    expect(second).toMatchObject({ imported: 0, alreadyImported: 2, skipped: [] });
  });

  it("skips bad rows with a reason and imports the rest", async () => {
    const shared = code();
    const good = row();
    const rows = [
      good,
      row({ name: "Nobody Here" }),
      row({ name: "Import Twin" }),
      row({ reference: shared }),
      row({ reference: shared, amountCents: 999_00 }),
      row({ date: "2023-06-16" }),
      row({ date: "2019-06-30" }),
    ];
    const result = await importPayments(treasurer, { fileName: "mixed.csv", rows }, meta, TODAY);
    if (!result.ok) throw new Error(result.message);
    expect(result.imported).toBe(2);
    const reasons = Object.fromEntries(result.skipped.map((s) => [s.line, s.reason]));
    expect(reasons[rows[1].line]).toMatch(/isn't on the parishioner list/);
    expect(reasons[rows[2].line]).toMatch(/More than one parishioner/);
    expect(reasons[rows[4].line]).toMatch(/already recorded/);
    expect(reasons[rows[5].line]).toMatch(/future/);
    expect(reasons[rows[6].line]).toMatch(/No quota period/);
  });

  it("flags old rows as backdated in the audit log", async () => {
    const r = row({ date: "2023-01-10" });
    await importPayments(treasurer, { fileName: "old.csv", rows: [r] }, meta, TODAY);
    const { rows } = await db.query(
      `SELECT a.is_backdated FROM audit_log a JOIN contributions c ON c.id::text = a.entity_id WHERE c.mpesa_code = $1 AND a.action = 'contribution.recorded'`,
      [r.reference],
    );
    expect(rows[0].is_backdated).toBe(true);
  });

  it("refuses an empty or oversized import", async () => {
    expect(await importPayments(treasurer, { fileName: "empty.csv", rows: [] }, meta, TODAY)).toMatchObject({ ok: false });
    const many = Array.from({ length: 2001 }, () => row());
    expect(await importPayments(treasurer, { fileName: "huge.csv", rows: many }, meta, TODAY)).toMatchObject({ ok: false });
  });

  it("row keys depend on content only, not position or case", () => {
    const base = { date: "2023-06-01", name: "Import Alpha", amountCents: 100, method: "mpesa" as const, reference: "ABCDEFGHIJ" };
    expect(rowKey(base)).toBe(rowKey({ ...base, name: "import alpha", reference: "abcdefghij" }));
    expect(rowKey(base)).not.toBe(rowKey({ ...base, amountCents: 101 }));
    expect(rowKey(base)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
