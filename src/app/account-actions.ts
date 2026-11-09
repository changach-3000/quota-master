"use server";

import { getViewer, requestMeta, setSessionCookie } from "@/lib/session";
import { changePassword } from "@/services/auth";
import { z } from "zod";

export type ChangePasswordState = { ok?: boolean; fieldErrors?: { current?: string; next?: string; confirm?: string } };

const schema = z.object({ current: z.string().min(1, "Enter your current password").max(512), next: z.string().max(512), confirm: z.string() });

/** Any signed-in user changing their own password. Other devices are signed out. */
export async function changePasswordAction(_prev: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: { current: z.flattenError(parsed.error).fieldErrors.current?.[0] } };
  if (parsed.data.next !== parsed.data.confirm) return { fieldErrors: { confirm: "The two new passwords don't match" } };

  const result = await changePassword(await getViewer(), parsed.data.current, parsed.data.next, await requestMeta());
  if (!result.ok) return { fieldErrors: { [result.field]: result.message } };
  // The old session was revoked with the others; keep this browser signed in.
  await setSessionCookie(result.token, result.expiresAt);
  return { ok: true };
}
