// Recording bank deposits against the test database. Uses the 2021 period
// with `today` fixed in mid-2021, apart from the other test files' periods.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordDeposit } from "@/services/deposit-recording";
import { listUndeposited } from "@/services/deposits";
import { recordPayment, reversePayment } from "@/services/payments";
import { ForbiddenError, type Viewer } from "@/services/viewer";
import { testDatabaseUrl } from "../db/global-setup";

const db = new Client({ connectionString: testDatabaseUrl() });
const meta = { ip: null, userAgent: "vitest" };
const TODAY = "2021-06-15";

let treasurer: Viewer;
let auditor: Viewer;
let personId: string;
let seq = 0;

/** Records a payment (KSh) and returns its id. */
async function pay(shillings: number, receivedOn = "2021-06-01") {
  const r = await recordPayment(
    treasurer,
    { parishionerId: personId, method: "mpesa", mpesaCode: `DEP${String(++seq).padStart(7, "0")}`, amount: String(shillings), receivedOn, idempotencyKey: randomUUID() },
    meta,
    TODAY,
  );
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.contributionId;
}

function deposit(contributionIds: string[], slipAmount: string, overrides: Partial<Parameters<typeof recordDeposit>[1]> = {}) {
  return { contributionIds, slipAmount, depositedOn: "2021-06-14", bankRef: "NCBA-TEST", idempotencyKey: randomUUID(), ...overrides };
}

beforeAll(async () => {
  await db.connect();
  await db.query(`INSERT INTO quota_periods (name, starts_on, ends_on) VALUES ('2021', '2021-01-01', '2021-12-31')`);
  const { rows: [church] } = await db.query(`INSERT INTO churches (name) VALUES ('Deposits Church') RETURNING id`);
  personId = (await db.query(`INSERT INTO parishioners (church_id, display_name) VALUES ($1, 'Deposits Person') RETURNING id`, [church.id])).rows[0].id;
  const mk = async (role: string) => (await db.query(`INSERT INTO users (email, role) VALUES ($1, $2) RETURNING id`, [`${role}-${randomUUID().slice(0, 6)}@dep.test`, role])).rows[0].id;
  treasurer = { userId: await mk("treasurer"), role: "treasurer", parishionerId: null };
  auditor = { userId: await mk("auditor"), role: "auditor", parishionerId: null };
});

afterAll(async () => {
  await db.end();
});

describe("recordDeposit", () => {
  it("only the treasurer or an admin can record deposits", async () => {
    const id = await pay(1000);
    await expect(recordDeposit(auditor, deposit([id], "1000"), meta, TODAY)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordDeposit(null, deposit([id], "1000"), meta, TODAY)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("banks the selected payments for the server-side total, with an audit row", async () => {
    const a = await pay(1500);
    const b = await pay(2500);
    const result = await recordDeposit(treasurer, deposit([a, b], "4,000"), meta, TODAY);
    expect(result).toMatchObject({ ok: true, amount: 400_000, items: 2, replayed: false });
    if (!result.ok) return;
    const { rows } = await db.query("SELECT amount_cents::int AS amount, recorded_by FROM deposits WHERE id = $1", [result.depositId]);
    expect(rows[0]).toEqual({ amount: 400_000, recorded_by: treasurer.userId });
    const audit = await db.query("SELECT action, after_data FROM audit_log WHERE entity_id = $1", [result.depositId]);
    expect(audit.rows[0]).toMatchObject({ action: "deposit.recorded", after_data: { amount_cents: 400_000, items: 2 } });
    const waiting = (await listUndeposited(treasurer)).map((p) => p.id);
    expect(waiting).not.toContain(a);
    expect(waiting).not.toContain(b);
  });

  it("refuses when the slip doesn't match the selected payments, and saves nothing", async () => {
    const a = await pay(1000);
    const result = await recordDeposit(treasurer, deposit([a], "999"), meta, TODAY);
    expect(result).toMatchObject({ ok: false, error: { code: "mismatch", selectedTotal: 100_000 } });
    expect((await listUndeposited(treasurer)).map((p) => p.id)).toContain(a);
  });

  it("refuses a payment that is already in a deposit", async () => {
    const a = await pay(1000);
    expect((await recordDeposit(treasurer, deposit([a], "1000"), meta, TODAY)).ok).toBe(true);
    expect(await recordDeposit(treasurer, deposit([a], "1000"), meta, TODAY)).toMatchObject({ ok: false, error: { code: "already_deposited" } });
  });

  it("two deposits racing for the same payment: exactly one wins", async () => {
    const shared = await pay(1000);
    const others = await Promise.all([pay(500), pay(700), pay(900)]);
    const results = await Promise.all(
      others.map((o, i) => recordDeposit(treasurer, deposit([shared, o], String(1000 + [500, 700, 900][i])), meta, TODAY)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const r of results.filter((x) => !x.ok)) expect(r).toMatchObject({ error: { code: "already_deposited" } });
    const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM deposit_items WHERE contribution_id = $1", [shared]);
    expect(rows[0].n).toBe(1);
  });

  it("won't bank a reversed payment or a reversal", async () => {
    const a = await pay(1000);
    const rev = await reversePayment(treasurer, { contributionId: a, reason: "Entered twice", idempotencyKey: randomUUID() }, meta, TODAY);
    if (!rev.ok) throw new Error("reverse failed");
    expect(await recordDeposit(treasurer, deposit([a], "1000"), meta, TODAY)).toMatchObject({ ok: false, error: { code: "not_depositable" } });
    expect(await recordDeposit(treasurer, deposit([rev.reversalId], "1000"), meta, TODAY)).toMatchObject({ ok: false, error: { code: "not_depositable" } });
    expect(await recordDeposit(treasurer, deposit([randomUUID()], "1000"), meta, TODAY)).toMatchObject({ ok: false, error: { code: "not_depositable" } });
  });

  it("refuses future dates and dates before the money was received", async () => {
    const a = await pay(1000, "2021-06-10");
    expect(await recordDeposit(treasurer, deposit([a], "1000", { depositedOn: "2021-06-16" }), meta, TODAY)).toMatchObject({ ok: false, error: { code: "future_date" } });
    expect(await recordDeposit(treasurer, deposit([a], "1000", { depositedOn: "2021-06-09" }), meta, TODAY)).toMatchObject({ ok: false, error: { code: "before_received" } });
  });

  it("validates input: at least one payment, no duplicates, a real amount", async () => {
    const a = await pay(1000);
    expect(await recordDeposit(treasurer, deposit([], "1000"), meta, TODAY)).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(await recordDeposit(treasurer, deposit([a, a], "2000"), meta, TODAY)).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(await recordDeposit(treasurer, deposit([a], "abc"), meta, TODAY)).toMatchObject({ ok: false, error: { code: "invalid" } });
  });

  it("is idempotent, including concurrent submits with one key", async () => {
    const a = await pay(1200);
    const input = deposit([a], "1200");
    const results = await Promise.all(Array.from({ length: 4 }, () => recordDeposit(treasurer, input, meta, TODAY)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.map((r) => (r.ok ? r.depositId : null))).size).toBe(1);
    const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM deposits WHERE idempotency_key = $1", [input.idempotencyKey]);
    expect(rows[0].n).toBe(1);
  });

  it("refuses to reuse a key for a different deposit", async () => {
    const a = await pay(1000);
    const b = await pay(1000);
    const key = randomUUID();
    expect((await recordDeposit(treasurer, deposit([a], "1000", { idempotencyKey: key }), meta, TODAY)).ok).toBe(true);
    expect(await recordDeposit(treasurer, deposit([b], "1000", { idempotencyKey: key }), meta, TODAY)).toMatchObject({ ok: false, error: { code: "idempotency_conflict" } });
  });
});
