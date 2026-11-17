// Importing the treasurer's yearly sheet (2024 period, `today` in early 2025,
// apart from the other test files' periods).
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { YearSheetRow } from "@/schemas/year-sheet";
import { recordDeposit } from "@/services/deposit-recording";
import { listUndeposited } from "@/services/deposits";
import { ForbiddenError, type Viewer } from "@/services/viewer";
import { importYearSheet } from "@/services/year-sheet-import";
import { testDatabaseUrl } from "../db/global-setup";

const db = new Client({ connectionString: testDatabaseUrl() });
const meta = { ip: null, userAgent: "vitest" };
const TODAY = "2025-01-15";

let treasurer: Viewer;
let auditor: Viewer;
let periodId: string;
let churchId: string;
let line = 1;

const row = (name: string, quota: number | null, instalments: [number, "mpesa" | "cash", string | null][]): YearSheetRow => ({
  line: ++line,
  name,
  quotaCents: quota === null ? null : quota * 100,
  instalments: instalments.map(([amount, method, date], i) => ({ column: 3 + i, amountCents: amount * 100, method, date })),
});

const sheet = (rows: YearSheetRow[], overrides: Partial<Parameters<typeof importYearSheet>[1]> = {}) => ({
  fileName: "quota-2024.xlsx",
  periodId,
  churchId,
  asOfDate: "2024-12-31",
  rows,
  ...overrides,
});

async function payments(name: string) {
  const { rows } = await db.query(
    `SELECT c.amount_cents::int AS amount, c.method, to_char(c.received_on, 'YYYY-MM-DD') AS on, c.is_historical, c.date_is_estimated, c.mpesa_code, c.receipt_no
       FROM contributions c JOIN parishioners p ON p.id = c.parishioner_id
      WHERE p.display_name = $1 AND p.church_id = $2 ORDER BY c.amount_cents`,
    [name, churchId],
  );
  return rows;
}

beforeAll(async () => {
  await db.connect();
  periodId = (await db.query(`INSERT INTO quota_periods (name, starts_on, ends_on) VALUES ('2024', '2024-01-01', '2024-12-31') RETURNING id`)).rows[0].id;
  churchId = (await db.query(`INSERT INTO churches (name) VALUES ($1) RETURNING id`, [`Sheet Church ${randomUUID().slice(0, 6)}`])).rows[0].id;
  await db.query(`INSERT INTO parishioners (church_id, display_name) VALUES ($1, 'Existing Member'), ($1, 'Twin Name'), ($1, 'Twin Name')`, [churchId]);
  const mk = async (role: string) => (await db.query(`INSERT INTO users (email, role) VALUES ($1, $2) RETURNING id`, [`${role}-${randomUUID().slice(0, 6)}@sheet.test`, role])).rows[0].id;
  treasurer = { userId: await mk("treasurer"), role: "treasurer", parishionerId: null };
  auditor = { userId: await mk("auditor"), role: "auditor", parishionerId: null };
});

afterAll(async () => {
  await db.end();
});

describe("importYearSheet", () => {
  it("only the treasurer or an admin can import", async () => {
    await expect(importYearSheet(auditor, sheet([row("Anyone", 1000, [])]), meta, TODAY)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("adds new people, sets pledges and records historical payments", async () => {
    const result = await importYearSheet(
      treasurer,
      sheet([
        row("New Member A", 15000, [
          [1000, "cash", null],
          [3200, "mpesa", null],
          [10000, "cash", "2024-06-02"],
        ]),
        row("existing member", 5000, [[5000, "mpesa", null]]),
      ]),
      meta,
      TODAY,
    );
    expect(result).toMatchObject({
      ok: true,
      people: { matched: 1, added: 1 },
      pledges: { set: 2, unchanged: 0 },
      payments: { recorded: 4, recordedCents: 1_920_000, alreadyImported: 0 },
      skipped: [],
    });

    expect(await payments("New Member A")).toEqual([
      { amount: 100_000, method: "cash", on: "2024-12-31", is_historical: true, date_is_estimated: true, mpesa_code: null, receipt_no: null },
      { amount: 320_000, method: "mpesa", on: "2024-12-31", is_historical: true, date_is_estimated: true, mpesa_code: null, receipt_no: null },
      { amount: 1_000_000, method: "cash", on: "2024-06-02", is_historical: true, date_is_estimated: false, mpesa_code: null, receipt_no: null },
    ]);
    const { rows: pledge } = await db.query(
      `SELECT pl.amount_cents::int AS amount, pl.version FROM pledges pl JOIN parishioners p ON p.id = pl.parishioner_id WHERE p.display_name = 'New Member A' AND pl.is_current`,
    );
    expect(pledge).toEqual([{ amount: 1_500_000, version: 1 }]);
  });

  it("importing the same sheet again records nothing new", async () => {
    const rows = [row("Repeat Member", 4000, [[2000, "cash", null], [2000, "mpesa", null]])];
    await importYearSheet(treasurer, sheet(rows), meta, TODAY);
    const again = await importYearSheet(treasurer, sheet(rows), meta, TODAY);
    expect(again).toMatchObject({ people: { matched: 1, added: 0 }, pledges: { set: 0, unchanged: 1 }, payments: { recorded: 0, alreadyImported: 2 } });
    expect(await payments("Repeat Member")).toHaveLength(2);
  });

  it("a changed quota on a later import becomes pledge version 2", async () => {
    await importYearSheet(treasurer, sheet([row("Quota Changer", 3000, [])]), meta, TODAY);
    const later = await importYearSheet(treasurer, sheet([row("Quota Changer", 4000, [])]), meta, TODAY);
    expect(later).toMatchObject({ pledges: { set: 1 } });
    const { rows } = await db.query(
      `SELECT pl.version, pl.is_current FROM pledges pl JOIN parishioners p ON p.id = pl.parishioner_id WHERE p.display_name = 'Quota Changer' ORDER BY pl.version`,
    );
    expect(rows).toEqual([{ version: 1, is_current: false }, { version: 2, is_current: true }]);
  });

  it("historical payments never wait for a deposit and can't be deposited", async () => {
    await importYearSheet(treasurer, sheet([row("Banked Long Ago", null, [[7000, "cash", null]])]), meta, TODAY);
    const { rows } = await db.query(`SELECT c.id FROM contributions c JOIN parishioners p ON p.id = c.parishioner_id WHERE p.display_name = 'Banked Long Ago'`);
    expect((await listUndeposited(treasurer)).map((p) => p.id)).not.toContain(rows[0].id);
    const attempt = await recordDeposit(treasurer, { contributionIds: [rows[0].id], depositedOn: "2025-01-10", slipAmount: "7000", idempotencyKey: randomUUID() }, meta, TODAY);
    expect(attempt).toMatchObject({ ok: false, error: { code: "not_depositable" } });
  });

  it("skips rows with ambiguous names or out-of-period dates, and imports the rest", async () => {
    const result = await importYearSheet(
      treasurer,
      sheet([row("Twin Name", 1000, [[1000, "cash", null]]), row("Bad Date", 1000, [[1000, "cash", "2023-12-31"]]), row("Fine Person", 1000, [[1000, "cash", null]])]),
      meta,
      TODAY,
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.skipped.map((s) => s.reason)).toEqual([expect.stringMatching(/More than one parishioner/), expect.stringMatching(/outside 2024/)]);
    expect(await payments("Fine Person")).toHaveLength(1);
    expect(await payments("Bad Date")).toHaveLength(0);
  });

  it("refuses an 'as at' date outside the period or in the future", async () => {
    expect(await importYearSheet(treasurer, sheet([row("X Person", 1000, [])], { asOfDate: "2025-01-01" }), meta, TODAY)).toMatchObject({ ok: false });
    expect(await importYearSheet(treasurer, sheet([row("X Person", 1000, [])], { asOfDate: "2024-12-31" }), meta, "2024-06-01")).toMatchObject({ ok: false });
  });

  it("audits payments as historical and summarises the import", async () => {
    await importYearSheet(treasurer, sheet([row("Audit Person", null, [[1500, "mpesa", null]])], { fileName: "audit-2024.xlsx" }), meta, TODAY);
    const { rows } = await db.query(
      `SELECT a.after_data, a.is_backdated FROM audit_log a JOIN contributions c ON c.id::text = a.entity_id
        JOIN parishioners p ON p.id = c.parishioner_id WHERE p.display_name = 'Audit Person' AND a.action = 'contribution.recorded'`,
    );
    expect(rows[0]).toMatchObject({ is_backdated: true, after_data: { historical: true, date_is_estimated: true, source: "audit-2024.xlsx" } });
    const summary = await db.query(`SELECT after_data FROM audit_log WHERE action = 'import.committed' AND entity_id = 'audit-2024.xlsx'`);
    expect(summary.rows[0].after_data).toMatchObject({ mode: "year_sheet", payments: 1 });
  });
});
