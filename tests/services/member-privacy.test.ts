// Handoff §4: log in as member A and prove member B's data is refused or omitted.
// Fixtures use the 2031 period so they never overlap the constraint tests' data.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMemberDashboard, getMyProfile } from "@/services/member-dashboard";
import { getParishOverview } from "@/services/treasurer-dashboard";
import { ForbiddenError, type Viewer } from "@/services/viewer";
import { testDatabaseUrl } from "../db/global-setup";

const db = new Client({ connectionString: testDatabaseUrl() });
const AS_OF = "2031-06-15";

let memberA: Viewer;
let memberB: Viewer;
let b: { id: string; name: string; code: string };

async function insert<T = { id: string }>(sql: string, params: unknown[]): Promise<T> {
  return (await db.query(sql, params)).rows[0] as T;
}

beforeAll(async () => {
  await db.connect();
  const period = await insert(
    `INSERT INTO quota_periods (name, starts_on, ends_on) VALUES ('2031', '2031-01-01', '2031-12-31') RETURNING id`,
    [],
  );
  const church = await insert(`INSERT INTO churches (name) VALUES ('Privacy Test Church') RETURNING id`, []);
  await db.query(`INSERT INTO church_quotas (church_id, period_id, amount_cents) VALUES ($1, $2, 10000000)`, [church.id, period.id]);

  const pa = await insert(`INSERT INTO parishioners (church_id, display_name) VALUES ($1, 'Member Alpha') RETURNING id`, [church.id]);
  const pb = await insert(`INSERT INTO parishioners (church_id, display_name) VALUES ($1, 'Member Bravo') RETURNING id`, [church.id]);
  b = { id: pb.id, name: "Member Bravo", code: "PRIVBRAVO1" };

  const pay = (parishioner: string, cents: number, code: string) =>
    db.query(
      `INSERT INTO contributions (kind, parishioner_id, period_id, amount_cents, method, mpesa_code, received_on, idempotency_key)
       VALUES ('payment', $1, $2, $3, 'mpesa', $4, '2031-03-01', $5)`,
      [parishioner, period.id, cents, code, randomUUID()],
    );
  await pay(pa.id, 100_000, "PRIVALPHA1");
  await pay(pb.id, 777_700, b.code);
  await db.query(
    `INSERT INTO pledges (parishioner_id, period_id, amount_cents, version, effective_from) VALUES ($1, $2, 999900, 1, '2031-01-01')`,
    [pb.id, period.id],
  );

  const ua = await insert(`INSERT INTO users (email, role, parishioner_id) VALUES ('alpha@privacy.test', 'member', $1) RETURNING id`, [pa.id]);
  const ub = await insert(`INSERT INTO users (email, role, parishioner_id) VALUES ('bravo@privacy.test', 'member', $1) RETURNING id`, [pb.id]);
  memberA = { userId: ua.id, role: "member", parishionerId: pa.id };
  memberB = { userId: ub.id, role: "member", parishionerId: pb.id };
});

afterAll(async () => {
  await db.end();
});

describe("member dashboard privacy", () => {
  it("shows member A only their own payments", async () => {
    const data = await getMemberDashboard(memberA, AS_OF);
    expect(data).not.toBeNull();
    expect(data!.me.name).toBe("Member Alpha");
    expect(data!.payments.map((p) => p.reference)).toEqual(["PRIVALPHA1"]);
    expect(data!.pledge).toEqual({ pledged: 0, received: 100_000, outstanding: 0, credit: 100_000 });
  });

  it("never carries member B's identity, codes or personal amounts", async () => {
    const serialised = JSON.stringify(await getMemberDashboard(memberA, AS_OF));
    expect(serialised).not.toContain(b.id);
    expect(serialised).not.toContain(b.name);
    expect(serialised).not.toContain(b.code);
    expect(serialised).not.toContain("999900"); // B's pledge
    expect(serialised).not.toContain("777700"); // B's payment on its own
  });

  it("reports church totals as sums only", async () => {
    const { church } = (await getMemberDashboard(memberA, AS_OF))!;
    expect(church.collected).toBe(877_700);
    expect(Object.keys(church).sort()).toEqual(["collected", "collectedLastYear", "monthly", "quota"]);
  });

  it("gives member B their own view, not A's", async () => {
    const data = await getMemberDashboard(memberB, AS_OF);
    expect(data!.payments.map((p) => p.reference)).toEqual([b.code]);
    expect(JSON.stringify(data)).not.toContain("PRIVALPHA1");
  });

  it("profile returns the viewer's own name only", async () => {
    expect(await getMyProfile(memberA)).toEqual({ name: "Member Alpha", church: "Privacy Test Church", email: "alpha@privacy.test" });
  });

  it("refuses a viewer with no parishioner, and no viewer at all", async () => {
    const staff: Viewer = { userId: randomUUID(), role: "treasurer", parishionerId: null };
    await expect(getMemberDashboard(staff, AS_OF)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getMemberDashboard(null, AS_OF)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses the parish overview to members", async () => {
    await expect(getParishOverview(memberA, AS_OF)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getParishOverview(null, AS_OF)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
