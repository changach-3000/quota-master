// Synthetic demo data: three churches, 130 parishioners, two quota periods
// (2025 full year, 2026 up to today), payments, a few reversals, and
// fortnightly NCBA deposits. No real names or amounts.
//
// Contributions are append-only, so this only runs against an empty ledger.
// Run: npx prisma db seed
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: [".env.local", ".env"], quiet: true });

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");

// Deterministic PRNG so every developer gets the same data.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261103);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const round500 = (shillings: number) => Math.max(500, Math.round(shillings / 500) * 500);
const cents = (shillings: number) => shillings * 100;

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());
const DAY = 86_400_000;
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const fromIso = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

const PERIODS = [
  { name: "2025", starts: "2025-01-01", ends: "2025-12-31" },
  { name: "2026", starts: "2026-01-01", ends: "2026-12-31" },
] as const;

const CHURCHES = [
  { name: "St. Peter's", members: 60, quota: { "2025": 1_650_000, "2026": 1_800_000 } },
  { name: "St. Mary's", members: 40, quota: { "2025": 1_100_000, "2026": 1_200_000 } },
  { name: "Holy Trinity", members: 30, quota: { "2025": 840_000, "2026": 900_000 } },
] as const;

const usedCodes = new Set<string>();
function mpesaCode(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code: string;
  do {
    code = "S" + Array.from({ length: 9 }, () => pick([...alphabet])).join("");
  } while (usedCodes.has(code));
  usedCodes.add(code);
  return code;
}
let receiptSeq = 0;
const receipt = () => `R-${String(++receiptSeq).padStart(4, "0")}`;

type Contribution = {
  id: string;
  kind: "payment" | "reversal";
  parishioner_id: string;
  period_id: string;
  amount_cents: number;
  method: "mpesa" | "cash" | null;
  mpesa_code: string | null;
  receipt_no: string | null;
  received_on: string;
  reverses_id: string | null;
  reason: string | null;
  idempotency_key: string;
  recorded_by: string;
};

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query("SELECT count(*)::int AS n FROM contributions");
    if (rows[0].n > 0) {
      console.log("Ledger already has data; the seed only runs on an empty database. Nothing changed.");
      return;
    }

    await db.query("BEGIN");

    const periodIds: Record<string, string> = {};
    for (const p of PERIODS) {
      const r = await db.query(
        "INSERT INTO quota_periods (name, starts_on, ends_on) VALUES ($1, $2, $3) RETURNING id",
        [p.name, p.starts, p.ends],
      );
      periodIds[p.name] = r.rows[0].id;
    }

    // People and pledges.
    type Person = { id: string; churchId: string; pledges: Record<string, number> };
    const people: Person[] = [];
    let n = 0;
    for (const c of CHURCHES) {
      const church = await db.query("INSERT INTO churches (name) VALUES ($1) RETURNING id", [c.name]);
      const churchId: string = church.rows[0].id;
      for (const p of PERIODS) {
        await db.query("INSERT INTO church_quotas (church_id, period_id, amount_cents) VALUES ($1, $2, $3)", [
          churchId,
          periodIds[p.name],
          cents(c.quota[p.name]),
        ]);
      }
      // Income bands give each person a weight; pledges add up to ~95% of quota.
      const weights = Array.from({ length: c.members }, () => pick([1, 1, 2, 2, 2, 3, 3, 4, 5, 6, 8]));
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < c.members; i++) {
        const name = `Parishioner ${String(++n).padStart(3, "0")}`;
        const r = await db.query("INSERT INTO parishioners (church_id, display_name) VALUES ($1, $2) RETURNING id", [
          churchId,
          name,
        ]);
        const pledges: Record<string, number> = {};
        for (const p of PERIODS) {
          pledges[p.name] = round500((c.quota[p.name] * 0.95 * weights[i]) / totalWeight);
        }
        if (n === 1) pledges["2026"] = 24_000; // the demo member
        people.push({ id: r.rows[0].id, churchId, pledges });
      }
    }

    // Users (no passwords until real auth exists).
    const users = [
      { email: "admin@example.test", role: "admin", parishioner: null },
      { email: "treasurer@example.test", role: "treasurer", parishioner: null },
      { email: "auditor@example.test", role: "auditor", parishioner: null },
      { email: "member001@example.test", role: "member", parishioner: people[0].id },
      { email: "member002@example.test", role: "member", parishioner: people[1].id },
    ];
    const userIds: Record<string, string> = {};
    for (const u of users) {
      const r = await db.query("INSERT INTO users (email, role, parishioner_id) VALUES ($1, $2, $3) RETURNING id", [
        u.email,
        u.role,
        u.parishioner,
      ]);
      userIds[u.role] ??= r.rows[0].id;
    }
    const treasurer = userIds.treasurer;

    for (const person of people) {
      for (const p of PERIODS) {
        await db.query(
          `INSERT INTO pledges (parishioner_id, period_id, amount_cents, version, effective_from, created_by)
           VALUES ($1, $2, $3, 1, $4, $5)`,
          [person.id, periodIds[p.name], cents(person.pledges[p.name]), p.starts, treasurer],
        );
      }
    }

    // Payments.
    const contributions: Contribution[] = [];
    const payment = (personId: string, period: string, shillings: number, on: string, method: "mpesa" | "cash") => {
      const c: Contribution = {
        id: randomUUID(),
        kind: "payment",
        parishioner_id: personId,
        period_id: periodIds[period],
        amount_cents: cents(shillings),
        method,
        mpesa_code: method === "mpesa" ? mpesaCode() : null,
        receipt_no: method === "cash" ? receipt() : null,
        received_on: on,
        reverses_id: null,
        reason: null,
        idempotency_key: randomUUID(),
        recorded_by: treasurer,
      };
      contributions.push(c);
      return c;
    };

    for (const p of PERIODS) {
      const start = fromIso(p.starts);
      const end = Math.min(fromIso(p.ends), fromIso(today));
      if (end < start) continue;
      const share = (end - start) / (fromIso(p.ends) - start); // part of the year that has happened
      for (const [i, person] of people.entries()) {
        if (i === 0 && p.name === "2026") continue; // hand-written below
        const target = person.pledges[p.name] * between(0.7, 1.12) * share;
        const count = Math.max(1, Math.round(between(3, 8) * share));
        let paid = 0;
        for (let k = 0; k < count && paid < target; k++) {
          const amount = round500(Math.min(target - paid, (target / count) * between(0.6, 1.5)));
          const on = toIso(start + Math.floor(rand() * ((end - start) / DAY + 1)) * DAY);
          payment(person.id, p.name, amount, on, rand() < 0.7 ? "mpesa" : "cash");
          paid += amount;
        }
      }
    }

    // Demo member's 2026 giving, matching the design.
    const me = people[0].id;
    for (const [amount, on, method] of [
      [5_000, "2026-01-12", "mpesa"],
      [3_000, "2026-03-08", "cash"],
      [4_000, "2026-04-05", "mpesa"],
      [2_500, "2026-06-14", "mpesa"],
      [2_000, "2026-08-23", "cash"],
      [2_000, "2026-10-11", "mpesa"],
    ] as const) {
      if (on <= today) payment(me, "2026", amount, on, method);
    }

    // Corrections: reverse a few cash payments and re-enter them correctly.
    // (Cash only: a reversed M-Pesa code cannot be re-entered while codes are
    // globally unique; see the open question in the handoff.)
    const reversed = new Set<string>();
    const cashPayments = contributions.filter((c) => c.method === "cash" && c.parishioner_id !== me);
    for (const original of cashPayments.filter(() => rand() < 0.02).slice(0, 6)) {
      const fixOn = toIso(Math.min(fromIso(original.received_on) + DAY, fromIso(today)));
      const wrongPerson = rand() < 0.5;
      contributions.push({
        ...original,
        id: randomUUID(),
        kind: "reversal",
        method: null,
        mpesa_code: null,
        receipt_no: null,
        received_on: fixOn,
        reverses_id: original.id,
        reason: wrongPerson ? "Recorded against the wrong parishioner" : "Wrong amount entered",
        idempotency_key: randomUUID(),
      });
      reversed.add(original.id);
      const corrected = payment(
        wrongPerson ? pick(people).id : original.parishioner_id,
        PERIODS.find((p) => periodIds[p.name] === original.period_id)!.name,
        wrongPerson ? original.amount_cents / 100 : round500(original.amount_cents / 100 + 500),
        fixOn,
        "cash",
      );
      corrected.receipt_no = original.receipt_no;
    }

    contributions.sort((a, b) => a.received_on.localeCompare(b.received_on));
    await db.query(
      `INSERT INTO contributions
         (id, kind, parishioner_id, period_id, amount_cents, method, mpesa_code, receipt_no,
          received_on, reverses_id, reason, idempotency_key, recorded_by)
       SELECT id, kind, parishioner_id, period_id, amount_cents, method, mpesa_code, receipt_no,
              received_on, reverses_id, reason, idempotency_key, recorded_by
         FROM json_populate_recordset(null::contributions, $1)`,
      [JSON.stringify(contributions)],
    );
    await db.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, after_data)
       SELECT $1, 'contribution.recorded', 'contribution', id::text,
              jsonb_build_object('kind', kind, 'amount_cents', amount_cents, 'source', 'seed')
         FROM contributions`,
      [treasurer],
    );

    // Fortnightly deposits (Fridays) of every payment received before the deposit day.
    const payments = contributions.filter((c) => c.kind === "payment" && !reversed.has(c.id));
    let depositDay = fromIso("2025-01-10");
    let windowStart = "0000-01-01";
    let deposits = 0;
    while (depositDay <= fromIso(today)) {
      const day = toIso(depositDay);
      const items = payments.filter((c) => c.received_on >= windowStart && c.received_on < day);
      if (items.length) {
        const total = items.reduce((s, c) => s + c.amount_cents, 0);
        const d = await db.query(
          "INSERT INTO deposits (deposited_on, amount_cents, bank_ref, recorded_by) VALUES ($1, $2, $3, $4) RETURNING id",
          [day, total, `NCBA-${day.replaceAll("-", "")}`, treasurer],
        );
        await db.query(
          "INSERT INTO deposit_items (deposit_id, contribution_id) SELECT $1, unnest($2::uuid[])",
          [d.rows[0].id, items.map((c) => c.id)],
        );
        deposits++;
      }
      windowStart = day;
      depositDay += 14 * DAY;
    }

    await db.query("COMMIT"); // deferred deposit-total checks run here
    console.log(
      `Seeded ${people.length} parishioners, ${contributions.length} contributions, ${deposits} deposits (as of ${today}).`,
    );
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
