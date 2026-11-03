import "server-only";
import { prisma } from "@/lib/db";
import { assertStaff, type Viewer } from "./viewer";

export type UndepositedPayment = {
  id: string;
  parishioner: string;
  church: string;
  method: "mpesa" | "cash";
  reference: string;
  receivedOn: string;
  amount: number;
};

export type DepositSummary = {
  id: string;
  depositedOn: string;
  amount: number;
  bankAccount: string;
  bankRef: string | null;
  items: number;
  mpesa: number;
  cash: number;
};

/** Payments not yet banked and not reversed, oldest first. */
export async function listUndeposited(viewer: Viewer | null): Promise<UndepositedPayment[]> {
  assertStaff(viewer);
  const rows = await prisma.$queryRaw<
    { id: string; parishioner: string; church: string; method: "mpesa" | "cash"; reference: string; received_on: string; amount_cents: bigint }[]
  >`
    SELECT c.id, pa.display_name AS parishioner, ch.name AS church, c.method,
           COALESCE(c.mpesa_code, c.receipt_no) AS reference,
           to_char(c.received_on, 'YYYY-MM-DD') AS received_on, c.amount_cents
      FROM contributions c
      JOIN parishioners pa ON pa.id = c.parishioner_id
      JOIN churches ch ON ch.id = pa.church_id
     WHERE c.kind = 'payment'
       AND NOT EXISTS (SELECT 1 FROM deposit_items di WHERE di.contribution_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM contributions r WHERE r.reverses_id = c.id)
     ORDER BY c.received_on, c.recorded_at`;
  return rows.map((r) => ({
    id: r.id,
    parishioner: r.parishioner,
    church: r.church,
    method: r.method,
    reference: r.reference,
    receivedOn: r.received_on,
    amount: Number(r.amount_cents),
  }));
}

export async function listDeposits(viewer: Viewer | null, limit = 50): Promise<DepositSummary[]> {
  assertStaff(viewer);
  const rows = await prisma.$queryRaw<
    { id: string; deposited_on: string; amount_cents: bigint; bank_account: string; bank_ref: string | null; items: number; mpesa: bigint; cash: bigint }[]
  >`
    SELECT d.id, to_char(d.deposited_on, 'YYYY-MM-DD') AS deposited_on, d.amount_cents, d.bank_account, d.bank_ref,
           COUNT(di.contribution_id)::int AS items,
           COALESCE(SUM(c.amount_cents) FILTER (WHERE c.method = 'mpesa'), 0)::bigint AS mpesa,
           COALESCE(SUM(c.amount_cents) FILTER (WHERE c.method = 'cash'), 0)::bigint  AS cash
      FROM deposits d
      LEFT JOIN deposit_items di ON di.deposit_id = d.id
      LEFT JOIN contributions c ON c.id = di.contribution_id
     GROUP BY d.id
     ORDER BY d.deposited_on DESC
     LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    depositedOn: r.deposited_on,
    amount: Number(r.amount_cents),
    bankAccount: r.bank_account,
    bankRef: r.bank_ref,
    items: r.items,
    mpesa: Number(r.mpesa),
    cash: Number(r.cash),
  }));
}
