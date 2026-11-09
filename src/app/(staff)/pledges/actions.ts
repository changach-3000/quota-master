"use server";

import { getViewer, requestMeta } from "@/lib/session";
import type { SetPledgeInput } from "@/schemas/pledge";
import { setPledge, type PledgeResult } from "@/services/pledge-setting";
import { ForbiddenError } from "@/services/viewer";

export async function setPledgeAction(input: SetPledgeInput): Promise<PledgeResult | { ok: false; error: { code: "forbidden"; message: string } }> {
  try {
    return await setPledge(await getViewer(), input, await requestMeta());
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: { code: "forbidden", message: err.message } };
    throw err;
  }
}
