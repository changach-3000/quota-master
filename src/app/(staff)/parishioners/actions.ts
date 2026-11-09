"use server";

import { getViewer, requestMeta } from "@/lib/session";
import type { ParishionerInput } from "@/schemas/settings";
import { addParishioner } from "@/services/settings-writes";
import { ForbiddenError } from "@/services/viewer";
import { refresh } from "next/cache";

export async function addParishionerAction(input: ParishionerInput) {
  try {
    const result = await addParishioner(await getViewer(), input, await requestMeta());
    if (result.ok) refresh();
    return result;
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false as const, message: err.message };
    throw err;
  }
}
