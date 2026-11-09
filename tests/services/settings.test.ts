// Parish set-up writes against the test database. Periods use 2040+ so they
// never overlap the other test files' periods.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addChurch, addParishioner, addPeriod, saveQuotas, updateMyPhone } from "@/services/settings-writes";
import { ForbiddenError, type Viewer } from "@/services/viewer";
import { testDatabaseUrl } from "../db/global-setup";

const db = new Client({ connectionString: testDatabaseUrl() });
const meta = { ip: null, userAgent: "vitest" };

let treasurer: Viewer;
let auditor: Viewer;
let member: Viewer;
let otherMemberPerson: string;
let churchA: string;
let churchB: string;
let period: string;

const uniq = () => randomUUID().slice(0, 8);

beforeAll(async () => {
  await db.connect();
  churchA = (await db.query(`INSERT INTO churches (name) VALUES ($1) RETURNING id`, [`Settings A ${uniq()}`])).rows[0].id;
  churchB = (await db.query(`INSERT INTO churches (name) VALUES ($1) RETURNING id`, [`Settings B ${uniq()}`])).rows[0].id;
  period = (await db.query(`INSERT INTO quota_periods (name, starts_on, ends_on) VALUES ('2040', '2040-01-01', '2040-12-31') RETURNING id`)).rows[0].id;
  const mk = async (role: string, pid: string | null = null) =>
    (await db.query(`INSERT INTO users (email, role, parishioner_id) VALUES ($1, $2, $3) RETURNING id`, [`${role}-${uniq()}@settings.test`, role, pid])).rows[0].id;
  const memberPerson = (await db.query(`INSERT INTO parishioners (church_id, display_name, phone) VALUES ($1, 'Settings Member', '+254700000001') RETURNING id`, [churchA])).rows[0].id;
  otherMemberPerson = (await db.query(`INSERT INTO parishioners (church_id, display_name, phone) VALUES ($1, 'Someone Else', '+254700000002') RETURNING id`, [churchA])).rows[0].id;
  treasurer = { userId: await mk("treasurer"), role: "treasurer", parishionerId: null };
  auditor = { userId: await mk("auditor"), role: "auditor", parishionerId: null };
  member = { userId: await mk("member", memberPerson), role: "member", parishionerId: memberPerson };
});

afterAll(async () => {
  await db.end();
});

describe("permissions", () => {
  it("auditors and members can't change parish set-up", async () => {
    for (const v of [auditor, member, null]) {
      await expect(saveQuotas(v, { periodId: period, quotas: [{ churchId: churchA, amount: "1000" }] }, meta)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(addPeriod(v, { name: "x", startsOn: "2099-01-01", endsOn: "2099-12-31" }, meta)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(addChurch(v, { name: "Nope" }, meta)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(addParishioner(v, { displayName: "Nope", churchId: churchA }, meta)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("saveQuotas", () => {
  it("creates and updates quotas, auditing only real changes", async () => {
    expect(await saveQuotas(treasurer, { periodId: period, quotas: [{ churchId: churchA, amount: "1,000,000" }, { churchId: churchB, amount: "500000" }] }, meta)).toEqual({
      ok: true,
      changed: 2,
    });
    expect(await saveQuotas(treasurer, { periodId: period, quotas: [{ churchId: churchA, amount: "1,200,000" }, { churchId: churchB, amount: "500000" }] }, meta)).toEqual({
      ok: true,
      changed: 1,
    });
    const { rows } = await db.query(`SELECT church_id, amount_cents::bigint::text AS amount FROM church_quotas WHERE period_id = $1 ORDER BY amount_cents`, [period]);
    expect(rows).toEqual([
      { church_id: churchB, amount: "50000000" },
      { church_id: churchA, amount: "120000000" },
    ]);
    const audit = await db.query(`SELECT before_data, after_data FROM audit_log WHERE action = 'quota.set' AND entity_id = $1 ORDER BY id`, [`${churchA}:${period}`]);
    expect(audit.rows).toEqual([
      { before_data: null, after_data: { amount_cents: 100_000_000 } },
      { before_data: { amount_cents: 100_000_000 }, after_data: { amount_cents: 120_000_000 } },
    ]);
  });

  it("rejects bad amounts and unknown periods", async () => {
    expect(await saveQuotas(treasurer, { periodId: period, quotas: [{ churchId: churchA, amount: "lots" }] }, meta)).toMatchObject({ ok: false });
    expect(await saveQuotas(treasurer, { periodId: randomUUID(), quotas: [{ churchId: churchA, amount: "1000" }] }, meta)).toMatchObject({ ok: false });
  });
});

describe("addPeriod", () => {
  it("adds a period and audits it", async () => {
    const r = await addPeriod(treasurer, { name: "2041", startsOn: "2041-01-01", endsOn: "2041-12-31" }, meta);
    expect(r.ok).toBe(true);
  });

  it("explains overlaps, duplicate names and backwards dates", async () => {
    expect(await addPeriod(treasurer, { name: "Mid 2040", startsOn: "2040-06-01", endsOn: "2041-05-31" }, meta)).toMatchObject({
      ok: false,
      fieldErrors: { startsOn: expect.stringMatching(/overlap/) },
    });
    expect(await addPeriod(treasurer, { name: "2040", startsOn: "2045-01-01", endsOn: "2045-12-31" }, meta)).toMatchObject({
      ok: false,
      fieldErrors: { name: expect.stringMatching(/already exists/) },
    });
    expect(await addPeriod(treasurer, { name: "Backwards", startsOn: "2046-12-31", endsOn: "2046-01-01" }, meta)).toMatchObject({ ok: false, fieldErrors: { endsOn: expect.any(String) } });
  });
});

describe("addChurch", () => {
  it("adds a church once", async () => {
    const name = `New Church ${uniq()}`;
    expect((await addChurch(treasurer, { name }, meta)).ok).toBe(true);
    expect(await addChurch(treasurer, { name }, meta)).toMatchObject({ ok: false, fieldErrors: { name: expect.stringMatching(/already exists/) } });
  });
});

describe("addParishioner", () => {
  it("adds a parishioner with a normalised phone and reuses households", async () => {
    const household = `Household ${uniq()}`;
    const a = await addParishioner(treasurer, { displayName: "New Person A", churchId: churchA, household, phone: "0712 345 678" }, meta);
    const b = await addParishioner(treasurer, { displayName: "New Person B", churchId: churchA, household }, meta);
    if (!a.ok || !b.ok) throw new Error("add failed");
    const { rows } = await db.query(`SELECT id, household_id, phone FROM parishioners WHERE id = ANY($1) ORDER BY display_name`, [[a.id, b.id]]);
    expect(rows[0].phone).toBe("+254712345678");
    expect(rows[0].household_id).toBe(rows[1].household_id);
    expect(rows[0].household_id).not.toBeNull();
  });

  it("validates name, church and phone", async () => {
    expect(await addParishioner(treasurer, { displayName: "X", churchId: churchA }, meta)).toMatchObject({ ok: false, fieldErrors: { displayName: expect.any(String) } });
    expect(await addParishioner(treasurer, { displayName: "Valid Name", churchId: randomUUID() }, meta)).toMatchObject({ ok: false, fieldErrors: { churchId: expect.any(String) } });
    expect(await addParishioner(treasurer, { displayName: "Valid Name", churchId: churchA, phone: "12345" }, meta)).toMatchObject({ ok: false, fieldErrors: { phone: expect.any(String) } });
  });
});

describe("updateMyPhone", () => {
  it("changes only the member's own number, and doesn't put numbers in the audit log", async () => {
    expect(await updateMyPhone(member, "+254 711 000 999", meta)).toEqual({ ok: true, phone: "+254711000999" });
    const { rows } = await db.query(`SELECT id, phone FROM parishioners WHERE id = ANY($1)`, [[member.parishionerId, otherMemberPerson]]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.phone]))).toEqual({ [member.parishionerId!]: "+254711000999", [otherMemberPerson]: "+254700000002" });
    const audit = await db.query(`SELECT before_data::text || after_data::text AS data FROM audit_log WHERE action = 'parishioner.phone_changed' AND entity_id = $1`, [member.parishionerId]);
    expect(audit.rows[0].data).not.toMatch(/2547/);
  });

  it("allows clearing the number, refuses bad numbers and non-members", async () => {
    expect(await updateMyPhone(member, "", meta)).toEqual({ ok: true, phone: null });
    expect(await updateMyPhone(member, "999", meta)).toMatchObject({ ok: false, fieldErrors: { phone: expect.any(String) } });
    await expect(updateMyPhone(treasurer, "0712345678", meta)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
