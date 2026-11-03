// Milestone 1: the database itself must reject bad data, whatever the app does.
// Each test runs inside a transaction that is rolled back afterwards.
import { randomUUID } from "node:crypto";
import { Client, DatabaseError } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./global-setup";

const db = new Client({ connectionString: testDatabaseUrl() });

type Fixture = { periodId: string; churchId: string; parishionerId: string };
let fx: Fixture;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query(sql, params);
  return rows[0] as T;
}

/** Runs `sql` in a savepoint and returns the Postgres error it raised (fails if none). */
async function dbError(sql: string, params: unknown[] = []): Promise<DatabaseError> {
  await db.query("SAVEPOINT expect_error");
  try {
    await db.query(sql, params);
  } catch (err) {
    await db.query("ROLLBACK TO SAVEPOINT expect_error");
    if (err instanceof DatabaseError) return err;
    throw err;
  }
  throw new Error(`Expected a database error from: ${sql}`);
}

let mpesaSeq = 0;
function mpesaCode(): string {
  return `TST${String(++mpesaSeq).padStart(7, "0")}`;
}

async function insertPayment(
  overrides: Partial<{ amount: number; method: "mpesa" | "cash"; mpesaCode: string | null; key: string }> = {},
): Promise<string> {
  const method = overrides.method ?? "mpesa";
  const code = overrides.mpesaCode !== undefined ? overrides.mpesaCode : method === "mpesa" ? mpesaCode() : null;
  const row = await one<{ id: string }>(
    `INSERT INTO contributions
       (kind, parishioner_id, period_id, amount_cents, method, mpesa_code, receipt_no, received_on, idempotency_key)
     VALUES ('payment', $1, $2, $3, $4, $5, $6, '2026-03-12', $7) RETURNING id`,
    [
      fx.parishionerId,
      fx.periodId,
      overrides.amount ?? 1_250_000,
      method,
      code,
      method === "cash" ? "R-0001" : null,
      overrides.key ?? randomUUID(),
    ],
  );
  return row.id;
}

const REVERSAL_SQL = `
  INSERT INTO contributions
    (kind, parishioner_id, period_id, amount_cents, received_on, reverses_id, reason, idempotency_key)
  VALUES ('reversal', $1, $2, $3, '2026-03-13', $4, $5, $6) RETURNING id`;

async function insertReversal(reversesId: string, amount = 1_250_000): Promise<string> {
  const row = await one<{ id: string }>(REVERSAL_SQL, [
    fx.parishionerId, fx.periodId, amount, reversesId, "Entered twice", randomUUID(),
  ]);
  return row.id;
}

beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await db.query("BEGIN");
  const period = await one<{ id: string }>(
    `INSERT INTO quota_periods (name, starts_on, ends_on) VALUES ('2026', '2026-01-01', '2026-12-31') RETURNING id`,
  );
  const church = await one<{ id: string }>(`INSERT INTO churches (name) VALUES ('St. Peter''s') RETURNING id`);
  const parishioner = await one<{ id: string }>(
    `INSERT INTO parishioners (church_id, display_name) VALUES ($1, 'Parishioner 001') RETURNING id`,
    [church.id],
  );
  fx = { periodId: period.id, churchId: church.id, parishionerId: parishioner.id };
});

afterEach(async () => {
  await db.query("ROLLBACK");
});

describe("contributions", () => {
  it("rejects a duplicate M-Pesa code", async () => {
    await insertPayment({ mpesaCode: "SKL4ABC123" });
    const err = await dbError(
      `INSERT INTO contributions (kind, parishioner_id, period_id, amount_cents, method, mpesa_code, received_on, idempotency_key)
       VALUES ('payment', $1, $2, 500000, 'mpesa', 'SKL4ABC123', '2026-03-14', $3)`,
      [fx.parishionerId, fx.periodId, randomUUID()],
    );
    expect(err.code).toBe("23505");
    expect(err.constraint).toBe("contributions_mpesa_code_key");
  });

  it("rejects a duplicate idempotency key", async () => {
    const key = randomUUID();
    await insertPayment({ key });
    const err = await dbError(
      `INSERT INTO contributions (kind, parishioner_id, period_id, amount_cents, method, mpesa_code, received_on, idempotency_key)
       VALUES ('payment', $1, $2, 500000, 'mpesa', $3, '2026-03-14', $4)`,
      [fx.parishionerId, fx.periodId, mpesaCode(), key],
    );
    expect(err.code).toBe("23505");
    expect(err.constraint).toBe("contributions_idempotency_key_key");
  });

  it("rejects an M-Pesa payment without a code", async () => {
    const err = await dbError(
      `INSERT INTO contributions (kind, parishioner_id, period_id, amount_cents, method, received_on, idempotency_key)
       VALUES ('payment', $1, $2, 500000, 'mpesa', '2026-03-14', $3)`,
      [fx.parishionerId, fx.periodId, randomUUID()],
    );
    expect(err.code).toBe("23514");
    expect(err.constraint).toBe("contributions_mpesa_requires_code");
  });

  it("rejects UPDATE on a contribution", async () => {
    const id = await insertPayment();
    const err = await dbError(`UPDATE contributions SET amount_cents = 1 WHERE id = $1`, [id]);
    expect(err.code).toBe("23001");
    expect(err.message).toMatch(/append-only/);
  });

  it("rejects DELETE on a contribution", async () => {
    const id = await insertPayment();
    const err = await dbError(`DELETE FROM contributions WHERE id = $1`, [id]);
    expect(err.code).toBe("23001");
  });

  it("rejects TRUNCATE on contributions", async () => {
    await insertPayment();
    const err = await dbError(`TRUNCATE contributions CASCADE`);
    expect(err.code).toBe("23001");
  });

  it("rejects a reversal with a different amount", async () => {
    const id = await insertPayment({ amount: 1_250_000 });
    const err = await dbError(REVERSAL_SQL, [
      fx.parishionerId, fx.periodId, 1_000_000, id, "Wrong amount", randomUUID(),
    ]);
    expect(err.code).toBe("23503");
    expect(err.constraint).toBe("contributions_reversal_matches_original");
  });

  it("rejects a reversal for a different parishioner", async () => {
    const id = await insertPayment();
    const other = await one<{ id: string }>(
      `INSERT INTO parishioners (church_id, display_name) VALUES ($1, 'Parishioner 002') RETURNING id`,
      [fx.churchId],
    );
    const err = await dbError(REVERSAL_SQL, [other.id, fx.periodId, 1_250_000, id, "Wrong person", randomUUID()]);
    expect(err.constraint).toBe("contributions_reversal_matches_original");
  });

  it("rejects a reversal without a reason", async () => {
    const id = await insertPayment();
    const err = await dbError(REVERSAL_SQL, [fx.parishionerId, fx.periodId, 1_250_000, id, "  ", randomUUID()]);
    expect(err.constraint).toBe("contributions_reversal_shape");
  });

  it("rejects reversing the same payment twice", async () => {
    const id = await insertPayment();
    await insertReversal(id);
    const err = await dbError(REVERSAL_SQL, [
      fx.parishionerId, fx.periodId, 1_250_000, id, "Again", randomUUID(),
    ]);
    expect(err.code).toBe("23505");
    expect(err.constraint).toBe("contributions_reverses_id_key");
  });

  it("rejects reversing a reversal", async () => {
    const paymentId = await insertPayment();
    const reversalId = await insertReversal(paymentId);
    const err = await dbError(REVERSAL_SQL, [
      fx.parishionerId, fx.periodId, 1_250_000, reversalId, "Undo the undo", randomUUID(),
    ]);
    expect(err.code).toBe("23514");
    expect(err.message).toMatch(/cannot reverse a reversal/);
  });
});

describe("quota periods", () => {
  it("rejects overlapping periods", async () => {
    const err = await dbError(
      `INSERT INTO quota_periods (name, starts_on, ends_on) VALUES ('Mid 2026', '2026-06-01', '2027-05-31')`,
    );
    expect(err.code).toBe("23P01");
    expect(err.constraint).toBe("quota_periods_no_overlap");
  });

  it("allows an adjacent period", async () => {
    await expect(
      db.query(`INSERT INTO quota_periods (name, starts_on, ends_on) VALUES ('2027', '2027-01-01', '2027-12-31')`),
    ).resolves.toBeDefined();
  });
});

describe("pledges", () => {
  const PLEDGE_SQL = `
    INSERT INTO pledges (parishioner_id, period_id, amount_cents, version, effective_from)
    VALUES ($1, $2, $3, $4, '2026-01-01') RETURNING id`;

  it("rejects two current pledges for the same person and period", async () => {
    await db.query(PLEDGE_SQL, [fx.parishionerId, fx.periodId, 5_000_000, 1]);
    const err = await dbError(PLEDGE_SQL, [fx.parishionerId, fx.periodId, 6_000_000, 2]);
    expect(err.code).toBe("23505");
    expect(err.constraint).toBe("pledges_one_current_key");
  });

  it("allows a new version once the old one is retired", async () => {
    const v1 = await one<{ id: string }>(PLEDGE_SQL, [fx.parishionerId, fx.periodId, 5_000_000, 1]);
    await db.query(`UPDATE pledges SET is_current = false WHERE id = $1`, [v1.id]);
    await expect(db.query(PLEDGE_SQL, [fx.parishionerId, fx.periodId, 6_000_000, 2])).resolves.toBeDefined();
  });

  it("rejects editing a pledge amount", async () => {
    const v1 = await one<{ id: string }>(PLEDGE_SQL, [fx.parishionerId, fx.periodId, 5_000_000, 1]);
    const err = await dbError(`UPDATE pledges SET amount_cents = 1 WHERE id = $1`, [v1.id]);
    expect(err.message).toMatch(/versioned/);
  });
});

describe("deposits", () => {
  async function insertDeposit(amount: number): Promise<string> {
    const row = await one<{ id: string }>(
      `INSERT INTO deposits (deposited_on, amount_cents) VALUES ('2026-03-20', $1) RETURNING id`,
      [amount],
    );
    return row.id;
  }

  it("rejects one contribution in two deposits", async () => {
    const c = await insertPayment({ amount: 1_250_000 });
    const d1 = await insertDeposit(1_250_000);
    await db.query(`INSERT INTO deposit_items (deposit_id, contribution_id) VALUES ($1, $2)`, [d1, c]);
    const d2 = await insertDeposit(1_250_000);
    const err = await dbError(`INSERT INTO deposit_items (deposit_id, contribution_id) VALUES ($1, $2)`, [d2, c]);
    expect(err.code).toBe("23505");
    expect(err.constraint).toBe("deposit_items_contribution_key");
  });

  it("rejects depositing a reversal", async () => {
    const reversal = await insertReversal(await insertPayment());
    const d = await insertDeposit(1_250_000);
    const err = await dbError(`INSERT INTO deposit_items (deposit_id, contribution_id) VALUES ($1, $2)`, [d, reversal]);
    expect(err.message).toMatch(/only payments can be deposited/);
  });

  it("rejects a deposit whose amount differs from its items at commit", async () => {
    const c = await insertPayment({ amount: 1_250_000 });
    const d = await insertDeposit(1_000_000);
    await db.query(`INSERT INTO deposit_items (deposit_id, contribution_id) VALUES ($1, $2)`, [d, c]);
    // Deferred check fires at COMMIT; force it now so the test transaction can roll back.
    const err = await dbError(`SET CONSTRAINTS ALL IMMEDIATE`);
    expect(err.message).toMatch(/does not equal sum of its items/);
  });

  it("accepts a deposit whose amount equals its items", async () => {
    const a = await insertPayment({ amount: 1_250_000 });
    const b = await insertPayment({ amount: 750_000, method: "cash" });
    const d = await insertDeposit(2_000_000);
    await db.query(`INSERT INTO deposit_items (deposit_id, contribution_id) VALUES ($1, $2), ($1, $3)`, [d, a, b]);
    await expect(db.query(`SET CONSTRAINTS ALL IMMEDIATE`)).resolves.toBeDefined();
  });
});

describe("users", () => {
  it("rejects a member user with no parishioner", async () => {
    const err = await dbError(`INSERT INTO users (email, role) VALUES ('member@example.test', 'member')`);
    expect(err.code).toBe("23514");
    expect(err.constraint).toBe("users_member_has_parishioner");
  });

  it("rejects an email that differs only by case", async () => {
    await db.query(`INSERT INTO users (email, role) VALUES ('Treasurer@example.test', 'treasurer')`);
    const err = await dbError(`INSERT INTO users (email, role) VALUES ('treasurer@EXAMPLE.test', 'auditor')`);
    expect(err.constraint).toBe("users_email_lower_key");
  });
});

describe("audit_log", () => {
  it("rejects UPDATE and DELETE", async () => {
    const row = await one<{ id: string }>(
      `INSERT INTO audit_log (action, entity_type) VALUES ('test', 'none') RETURNING id`,
    );
    expect((await dbError(`UPDATE audit_log SET action = 'x' WHERE id = $1`, [row.id])).code).toBe("23001");
    expect((await dbError(`DELETE FROM audit_log WHERE id = $1`, [row.id])).code).toBe("23001");
  });
});

describe("parishioner_balances", () => {
  async function balance() {
    return one<{ pledged_cents: string; received_cents: string; outstanding_cents: string; credit_cents: string }>(
      `SELECT pledged_cents, received_cents, outstanding_cents, credit_cents
         FROM parishioner_balances WHERE parishioner_id = $1 AND period_id = $2`,
      [fx.parishionerId, fx.periodId],
    );
  }

  it("payment plus its reversal gives a balance of 0", async () => {
    await insertReversal(await insertPayment({ amount: 1_250_000 }));
    expect(await balance()).toEqual({
      pledged_cents: "0", received_cents: "0", outstanding_cents: "0", credit_cents: "0",
    });
  });

  it("derives outstanding and credit against the current pledge", async () => {
    await db.query(
      `INSERT INTO pledges (parishioner_id, period_id, amount_cents, version, effective_from)
       VALUES ($1, $2, 2000000, 1, '2026-01-01')`,
      [fx.parishionerId, fx.periodId],
    );
    await insertPayment({ amount: 1_250_000 });
    expect(await balance()).toMatchObject({ received_cents: "1250000", outstanding_cents: "750000", credit_cents: "0" });

    await insertPayment({ amount: 1_000_000 });
    expect(await balance()).toMatchObject({ received_cents: "2250000", outstanding_cents: "0", credit_cents: "250000" });
  });
});
