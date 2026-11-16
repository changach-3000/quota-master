"use server";

import { getViewer, requestMeta } from "@/lib/session";
import type { ImportInput } from "@/schemas/import";
import { importPayments, type ImportResult } from "@/services/import";
import { todayInNairobi } from "@/services/periods";
import { ForbiddenError } from "@/services/viewer";

export async function importPaymentsAction(input: ImportInput): Promise<ImportResult> {
  try {
    return await importPayments(await getViewer(), input, await requestMeta(), todayInNairobi());
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, message: err.message };
    throw err;
  }
}
