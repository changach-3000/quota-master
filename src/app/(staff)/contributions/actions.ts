"use server";

import { getViewer, requestMeta } from "@/lib/session";
import type { RecordPaymentInput, ReversePaymentInput } from "@/schemas/contribution";
import { recordPayment, reversePayment, type RecordResult, type ReverseResult } from "@/services/payments";
import { todayInNairobi } from "@/services/periods";
import { ForbiddenError } from "@/services/viewer";
import { refresh } from "next/cache";

type Forbidden = { ok: false; error: { code: "forbidden"; message: string } };
const forbidden = (err: ForbiddenError): Forbidden => ({ ok: false, error: { code: "forbidden", message: err.message } });

export async function recordPaymentAction(input: RecordPaymentInput): Promise<RecordResult | Forbidden> {
  try {
    return await recordPayment(await getViewer(), input, await requestMeta(), todayInNairobi());
  } catch (err) {
    if (err instanceof ForbiddenError) return forbidden(err);
    throw err;
  }
}

export async function reversePaymentAction(input: ReversePaymentInput): Promise<ReverseResult | Forbidden> {
  try {
    const result = await reversePayment(await getViewer(), input, await requestMeta(), todayInNairobi());
    if (result.ok) refresh();
    return result;
  } catch (err) {
    if (err instanceof ForbiddenError) return forbidden(err);
    throw err;
  }
}
