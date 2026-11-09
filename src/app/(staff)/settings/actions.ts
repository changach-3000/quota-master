"use server";

import { Prisma } from "@/generated/prisma/client";
import { getViewer, requestMeta } from "@/lib/session";
import { inviteUser, issuePasswordReset } from "@/services/auth";
import { ForbiddenError } from "@/services/viewer";
import { refresh } from "next/cache";
import { z } from "zod";

export type InviteState = { error?: string; fieldErrors?: { email?: string; parishionerId?: string }; link?: string; email?: string };
export type ResetState = { error?: string; link?: string };

const inviteSchema = z
  .object({
    email: z.email("Enter a valid email address").max(254),
    role: z.enum(["admin", "treasurer", "auditor", "member"]),
    parishionerId: z.string().optional(),
  })
  .refine((v) => v.role !== "member" || z.uuid().safeParse(v.parishionerId).success, {
    path: ["parishionerId"],
    message: "Members must be linked to their parishioner record",
  });

export async function inviteAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fe = z.flattenError(parsed.error).fieldErrors;
    return { fieldErrors: { email: fe.email?.[0], parishionerId: fe.parishionerId?.[0] } };
  }
  try {
    const { token } = await inviteUser(
      await getViewer(),
      { email: parsed.data.email, role: parsed.data.role, parishionerId: parsed.data.parishionerId || null },
      await requestMeta(),
    );
    refresh();
    return { link: `/set-password/${token}`, email: parsed.data.email };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Unique email (case-insensitive index) or parishioner already linked to a login.
      return { error: "That email, or that parishioner, already has an account." };
    }
    throw err;
  }
}

export async function resetAccessAction(userId: string): Promise<ResetState> {
  if (!z.uuid().safeParse(userId).success) return { error: "Unknown user" };
  try {
    const { token } = await issuePasswordReset(await getViewer(), userId, await requestMeta());
    return { link: `/set-password/${token}` };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }
}
