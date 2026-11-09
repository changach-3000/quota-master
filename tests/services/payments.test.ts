// Recording and reversing payments (handoff §8) against the test database.
// Uses the 2020 period with `today` fixed to mid-2020, so nothing here
// overlaps the other test files' periods.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordPayment, reversePayment } from "@/services/payments";
import { ForbiddenError, type Viewer } from "@/services/viewer";
import { testDatabaseUrl } from "../db/global-setup";

const db = new Client({ connectionString: testDatabaseUrl() });
const meta = { ip: null, userAgent: "vitest" };
const TODAY = "2020-06-15";

let treasurer: Viewer;
let auditor: Viewer;
let member: Viewer;
let personId: string;
let codeSeq = 0;

const code = () => `PAY${String(++codeSeq).padStart(7, "0")}`;

function payment(overrides: Partial<Parameters<typeof recordPayment>[1]> = {}) {
  return {
    parishionerId: personId,
    method: "mpesa" as const,
    mpesaCode: code(),
    amount: "2,500",
    receivedOn: "2020-06-14",
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

async function count(sql: string, params: unknown[]) {
  return (await db.query(sql, params)).rows[0].n as number;
}

async function newPerson() {
  const { rows } = await db.query(
    `INSERT INTO parishioners (church_id, display_name) SELECT id, 'Payments Person' FROM churches WHERE name = 'Payments Church' RETURNING id`,
  );
  return rows[0].id as string;
}

beforeAll(async () => {
  await db.connect();
  const { rows: [period] } = await db.query(`INSERT INTO quota_periods (name, starts_on, ends_on) VALUES ('2020', '2020-01-01', '2020-12-31') RETURNING id`);
  await db.query(`INSERT INTO churches (name) VALUES ('Payments Church')`);
  personId = await newPerson();
  await db.query(`INSERT INTO pledges (parishioner_id, period_id, amount_cents, version, effective_from) VALUES ($1, $2, 1000000, 1, '2020-01-01')`, [personId, period.id]);
  const mk = async (role: string, pid: string | null) =>
    (await db.query(`INSERT INTO users (email, role, parishioner_id) VALUES ($1, $2, $3) RETURNING id`, [`${role}-${randomUUID().slice(0, 6)}@pay.test`, role, pid])).rows[0].id;
  treasurer = { userId: await mk("treasurer", null), role: "treasurer", parishionerId: null };
  auditor = { userId: await mk("auditor", null), role: "auditor", parishionerId: null };
  const memberPerson = await newPerson();
  member = { userId: await mk("member", memberPerson), role: "member", parishionerId: memberPerson };
});

afterAll(async () => {
  await db.end();
});

describe("recordPayment", () => {
  it("only the treasurer or an admin can record", async () => {
    await expect(recordPayment(auditor, payment(), meta, TODAY)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordPayment(member, payment(), meta, TODAY)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordPayment(null, payment(), meta, TODAY)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("records the payment and its audit row together, and returns the derived balance", async () => {
    const before = await recordPayment(treasurer, payment({ amount: "1000" }), meta, TODAY);
    if (!before.ok) throw new Error(JSON.stringify(before.error));
    const result = await recordPayment(treasurer, payment({ amount: "2,500" }), meta, TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.amount).toBe(250_000);
    expect(result.balance.received - before.balance.received).toBe(250_000);
    expect(result.balance.pledged).toBe(1_000_000);
    expect(await count(`SELECT COUNT(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action = 'contribution.recorded'`, [result.contributionId])).toBe(1);
    expect(await count(`SELECT COUNT(*)::int AS n FROM contributions WHERE id = $1 AND recorded_by = $2`, [result.contributionId, treasurer.userId])).toBe(1);
  });

  it("is idempotent: the same key twice gives one payment", async () => {
    const input = payment();
    const first = await recordPayment(treasurer, input, meta, TODAY);
    const second = await recordPayment(treasurer, input, meta, TODAY);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.contributionId).toBe(first.contributionId);
    expect(second.replayed).toBe(true);
    expect(await count(`SELECT COUNT(*)::int AS n FROM contributions WHERE idempotency_key = $1`, [input.idempotencyKey])).toBe(1);
  });

  it("refuses to reuse a key for a different payment", async () => {
    const input = payment();
    await recordPayment(treasurer, input, meta, TODAY);
    const result = await recordPayment(treasurer, { ...input, amount: "9999", mpesaCode: code() }, meta, TODAY);
    expect(result).toMatchObject({ ok: false, error: { code: "idempotency_conflict" } });
  });

  it("concurrent submits with one key create exactly one payment", async () => {
    const input = payment();
    const results = await Promise.all(Array.from({ length: 6 }, () => recordPayment(treasurer, input, meta, TODAY)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.map((r) => (r.ok ? r.contributionId : null))).size).toBe(1);
    expect(await count(`SELECT COUNT(*)::int AS n FROM contributions WHERE idempotency_key = $1`, [input.idempotencyKey])).toBe(1);
  });

  it("rejects a duplicate M-Pesa code with a clear message, even under concurrency", async () => {
    const shared = code();
    const results = await Promise.all(Array.from({ length: 5 }, () => recordPayment(treasurer, payment({ mpesaCode: shared }), meta, TODAY)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.filter((r) => !r.ok);
    expect(failed).toHaveLength(4);
    for (const f of failed) {
      expect(f).toMatchObject({ ok: false, error: { code: "duplicate_mpesa", existing: { parishioner: "Payments Person", receivedOn: "2020-06-14" } } });
    }
  });

  it("validates input on the server too", async () => {
    const result = await recordPayment(treasurer, payment({ mpesaCode: "short", amount: "-5" }), meta, TODAY);
    expect(result).toMatchObject({ ok: false, error: { code: "invalid" } });
    if (!result.ok && result.error.code === "invalid") {
      expect(result.error.fieldErrors.mpesaCode).toBeTruthy();
      expect(result.error.fieldErrors.amount).toBeTruthy();
    }
  });

  it("refuses future dates and dates outside any period", async () => {
    expect(await recordPayment(treasurer, payment({ receivedOn: "2020-06-16" }), meta, TODAY)).toMatchObject({ ok: false, error: { code: "future_date" } });
    expect(await recordPayment(treasurer, payment({ receivedOn: "2019-12-31" }), meta, TODAY)).toMatchObject({ ok: false, error: { code: "no_period" } });
  });

  it("refuses unknown or inactive parishioners", async () => {
    expect(await recordPayment(treasurer, payment({ parishionerId: randomUUID() }), meta, TODAY)).toMatchObject({ ok: false, error: { code: "unknown_parishioner" } });
    const gone = await newPerson();
    await db.query("UPDATE parishioners SET is_active = false WHERE id = $1", [gone]);
    expect(await recordPayment(treasurer, payment({ parishionerId: gone }), meta, TODAY)).toMatchObject({ ok: false, error: { code: "unknown_parishioner" } });
  });

  it("flags entries older than a week as backdated in the audit log", async () => {
    const recent = await recordPayment(treasurer, payment({ receivedOn: "2020-06-10" }), meta, TODAY);
    const old = await recordPayment(treasurer, payment({ receivedOn: "2020-05-01" }), meta, TODAY);
    if (!recent.ok || !old.ok) throw new Error("record failed");
    expect(recent.backdated).toBe(false);
    expect(old.backdated).toBe(true);
    const { rows } = await db.query("SELECT entity_id, is_backdated FROM audit_log WHERE entity_id = ANY($1)", [[recent.contributionId, old.contributionId]]);
    expect(Object.fromEntries(rows.map((r) => [r.entity_id, r.is_backdated]))).toEqual({ [recent.contributionId]: false, [old.contributionId]: true });
  });

  it("records cash with a receipt number", async () => {
    const result = await recordPayment(treasurer, payment({ method: "cash", mpesaCode: undefined, receiptNo: "R-2020-1" }), meta, TODAY);
    expect(result.ok).toBe(true);
  });
});

describe("reversePayment", () => {
  async function recorded(amount = "3000") {
    const r = await recordPayment(treasurer, payment({ amount }), meta, TODAY);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r;
  }

  it("reverses a payment, brings the balance back, and audits the reason", async () => {
    const paid = await recorded("3000");
    const result = await reversePayment(treasurer, { contributionId: paid.contributionId, reason: "Entered twice", idempotencyKey: randomUUID() }, meta, TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.balance.received).toBe(paid.balance.received - 300_000);
    const { rows } = await db.query("SELECT action, before_data, after_data FROM audit_log WHERE entity_id = $1", [result.reversalId]);
    expect(rows[0]).toMatchObject({ action: "contribution.reversed", after_data: { reason: "Entered twice" }, before_data: { contribution_id: paid.contributionId } });
  });

  it("can't reverse the same payment twice, even at once", async () => {
    const paid = await recorded();
    const attempts = await Promise.all(
      Array.from({ length: 4 }, () => reversePayment(treasurer, { contributionId: paid.contributionId, reason: "Wrong amount entered", idempotencyKey: randomUUID() }, meta, TODAY)),
    );
    expect(attempts.filter((a) => a.ok)).toHaveLength(1);
    for (const a of attempts.filter((x) => !x.ok)) expect(a).toMatchObject({ error: { code: "already_reversed" } });
  });

  it("can't reverse a reversal", async () => {
    const paid = await recorded();
    const rev = await reversePayment(treasurer, { contributionId: paid.contributionId, reason: "Entered twice", idempotencyKey: randomUUID() }, meta, TODAY);
    if (!rev.ok) throw new Error("reverse failed");
    expect(await reversePayment(treasurer, { contributionId: rev.reversalId, reason: "Undo the undo", idempotencyKey: randomUUID() }, meta, TODAY)).toMatchObject({
      ok: false,
      error: { code: "not_reversible" },
    });
  });

  it("needs a reason, and only the treasurer or an admin can reverse", async () => {
    const paid = await recorded();
    expect(await reversePayment(treasurer, { contributionId: paid.contributionId, reason: " ", idempotencyKey: randomUUID() }, meta, TODAY)).toMatchObject({
      ok: false,
      error: { code: "invalid" },
    });
    await expect(reversePayment(auditor, { contributionId: paid.contributionId, reason: "Entered twice", idempotencyKey: randomUUID() }, meta, TODAY)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("is idempotent", async () => {
    const paid = await recorded();
    const key = randomUUID();
    const a = await reversePayment(treasurer, { contributionId: paid.contributionId, reason: "Entered twice", idempotencyKey: key }, meta, TODAY);
    const b = await reversePayment(treasurer, { contributionId: paid.contributionId, reason: "Entered twice", idempotencyKey: key }, meta, TODAY);
    expect(a.ok && b.ok && a.reversalId === b.reversalId && b.replayed).toBe(true);
  });

  it("reports an unknown payment", async () => {
    expect(await reversePayment(treasurer, { contributionId: randomUUID(), reason: "Entered twice", idempotencyKey: randomUUID() }, meta, TODAY)).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });
});
