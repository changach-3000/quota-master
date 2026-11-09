"use server";

import { getViewer, requestMeta } from "@/lib/session";
import type { RecordDepositInput } from "@/schemas/deposit";
import { recordDeposit, type DepositResult } from "@/services/deposit-recording";
import { todayInNairobi } from "@/services/periods";
import { ForbiddenError } from "@/services/viewer";

export async function recordDepositAction(input: RecordDepositInput): Promise<DepositResult | { ok: false; error: { code: "forbidden"; message: string } }> {
  try {
    return await recordDeposit(await getViewer(), input, await requestMeta(), todayInNairobi());
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: { code: "forbidden", message: err.message } };
    throw err;
  }
}
