// Setting versioned pledges against the test database (2022 period, apart
// from the other test files).
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordPayment } from "@/services/payments";
import { setPledge } from "@/services/pledge-setting";
import { ForbiddenError, type Viewer } from "@/services/viewer";
import { testDatabaseUrl } from "../db/global-setup";

const db = new Client({ connectionString: testDatabaseUrl() });
const meta = { ip: null, userAgent: "vitest" };

let treasurer: Viewer;
let auditor: Viewer;
let periodId: string;
let churchId: string;

async function person() {
  return (await db.query(`INSERT INTO parishioners (church_id, display_name) VALUES ($1, 'Pledge Person') RETURNING id`, [churchId])).rows[0].id as string;
}

const pledge = (parishionerId: string, amount: string, effectiveFrom = "2022-01-01", idempotencyKey = randomUUID()) => ({
  parishionerId,
  periodId,
  amount,
  effectiveFrom,
  idempotencyKey,
});

async function versions(parishionerId: string) {
  const { rows } = await db.query(
    `SELECT version, amount_cents::int AS amount, is_current, supersedes_id FROM pledges WHERE parishioner_id = $1 ORDER BY version`,
    [parishionerId],
  );
  return rows;
}

beforeAll(async () => {
  await db.connect();
  periodId = (await db.query(`INSERT INTO quota_periods (name, starts_on, ends_on) VALUES ('2022', '2022-01-01', '2022-12-31') RETURNING id`)).rows[0].id;
  churchId = (await db.query(`INSERT INTO churches (name) VALUES ('Pledges Church') RETURNING id`)).rows[0].id;
  const mk = async (role: string) => (await db.query(`INSERT INTO users (email, role) VALUES ($1, $2) RETURNING id`, [`${role}-${randomUUID().slice(0, 6)}@pledge.test`, role])).rows[0].id;
  treasurer = { userId: await mk("treasurer"), role: "treasurer", parishionerId: null };
  auditor = { userId: await mk("auditor"), role: "auditor", parishionerId: null };
});

afterAll(async () => {
  await db.end();
});

describe("setPledge", () => {
  it("only the treasurer or an admin can set pledges", async () => {
    const p = await person();
    await expect(setPledge(auditor, pledge(p, "10000"), meta)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setPledge(null, pledge(p, "10000"), meta)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("creates version 1, then a change retires it and adds version 2", async () => {
    const p = await person();
    expect(await setPledge(treasurer, pledge(p, "10,000"), meta)).toMatchObject({ ok: true, version: 1, amount: 1_000_000 });
    const second = await setPledge(treasurer, pledge(p, "12,000", "2022-04-01"), meta);
    expect(second).toMatchObject({ ok: true, version: 2, amount: 1_200_000 });

    const v = await versions(p);
    expect(v.map(({ version, amount, is_current }) => ({ version, amount, is_current }))).toEqual([
      { version: 1, amount: 1_000_000, is_current: false },
      { version: 2, amount: 1_200_000, is_current: true },
    ]);
    const { rows } = await db.query("SELECT id FROM pledges WHERE parishioner_id = $1 AND version = 1", [p]);
    expect(v[1].supersedes_id).toBe(rows[0].id);
  });

  it("returns the balance against the new pledge", async () => {
    const p = await person();
    await setPledge(treasurer, pledge(p, "10000"), meta);
    const pay = await recordPayment(
      treasurer,
      { parishionerId: p, method: "cash", receiptNo: "R-PL-1", amount: "4000", receivedOn: "2022-03-01", idempotencyKey: randomUUID() },
      meta,
      "2022-06-15",
    );
    expect(pay.ok).toBe(true);
    expect(await setPledge(treasurer, pledge(p, "3000", "2022-06-01"), meta)).toMatchObject({ ok: true, outstanding: 0, credit: 100_000 });
  });

  it("audits each change with the version before and after", async () => {
    const p = await person();
    await setPledge(treasurer, pledge(p, "5000"), meta);
    const r = await setPledge(treasurer, pledge(p, "6000"), meta);
    if (!r.ok) throw new Error("set failed");
    const { rows } = await db.query("SELECT action, before_data, after_data FROM audit_log WHERE entity_id = $1", [r.pledgeId]);
    expect(rows[0]).toMatchObject({
      action: "pledge.set",
      before_data: { version: 1, amount_cents: 500_000 },
      after_data: { version: 2, amount_cents: 600_000 },
    });
  });

  it("refuses no-op changes, dates outside the period, and backdating before the current version", async () => {
    const p = await person();
    await setPledge(treasurer, pledge(p, "8000", "2022-03-01"), meta);
    expect(await setPledge(treasurer, pledge(p, "8000"), meta)).toMatchObject({ ok: false, error: { code: "unchanged" } });
    expect(await setPledge(treasurer, pledge(p, "9000", "2023-01-01"), meta)).toMatchObject({ ok: false, error: { code: "outside_period" } });
    expect(await setPledge(treasurer, pledge(p, "9000", "2022-02-01"), meta)).toMatchObject({ ok: false, error: { code: "before_current" } });
  });

  it("refuses unknown periods, unknown or inactive people, and bad amounts", async () => {
    const p = await person();
    expect(await setPledge(treasurer, { ...pledge(p, "1000"), periodId: randomUUID() }, meta)).toMatchObject({ ok: false, error: { code: "unknown_period" } });
    expect(await setPledge(treasurer, pledge(randomUUID(), "1000"), meta)).toMatchObject({ ok: false, error: { code: "unknown_parishioner" } });
    await db.query("UPDATE parishioners SET is_active = false WHERE id = $1", [p]);
    expect(await setPledge(treasurer, pledge(p, "1000"), meta)).toMatchObject({ ok: false, error: { code: "unknown_parishioner" } });
    expect(await setPledge(treasurer, pledge(await person(), "-5"), meta)).toMatchObject({ ok: false, error: { code: "invalid" } });
  });

  it("concurrent changes to one person queue up: distinct versions, one current", async () => {
    const p = await person();
    const amounts = ["1000", "2000", "3000", "4000", "5000"];
    const results = await Promise.all(amounts.map((a) => setPledge(treasurer, pledge(p, a), meta)));
    expect(results.every((r) => r.ok)).toBe(true);
    const v = await versions(p);
    expect(v.map((x) => x.version)).toEqual([1, 2, 3, 4, 5]);
    expect(v.filter((x) => x.is_current)).toHaveLength(1);
  });

  it("is idempotent, including concurrent submits with one key", async () => {
    const p = await person();
    const input = pledge(p, "7000");
    const results = await Promise.all(Array.from({ length: 4 }, () => setPledge(treasurer, input, meta)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && !r.replayed)).toHaveLength(1);
    expect(await versions(p)).toHaveLength(1);
  });

  it("refuses to reuse a key for a different pledge", async () => {
    const p = await person();
    const key = randomUUID();
    await setPledge(treasurer, pledge(p, "7000", "2022-01-01", key), meta);
    expect(await setPledge(treasurer, pledge(p, "7500", "2022-01-01", key), meta)).toMatchObject({ ok: false, error: { code: "idempotency_conflict" } });
  });

  it("the database still refuses editing an old version directly", async () => {
    const p = await person();
    await setPledge(treasurer, pledge(p, "1000"), meta);
    await setPledge(treasurer, pledge(p, "2000"), meta);
    await expect(db.query("UPDATE pledges SET amount_cents = 1 WHERE parishioner_id = $1 AND version = 1", [p])).rejects.toThrow(/versioned/);
  });
});
