"use server";

import { getViewer, requestMeta } from "@/lib/session";
import { updateMyPhone } from "@/services/settings-writes";
import { ForbiddenError } from "@/services/viewer";

/** The parishioner is taken from the session, never from the form. */
export async function updateMyPhoneAction(phone: string) {
  try {
    return await updateMyPhone(await getViewer(), phone, await requestMeta());
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false as const, message: err.message };
    throw err;
  }
}
