import { z } from "zod";
import { isoDate, kshAmount } from "./money";

export const periodSchema = z
  .object({ name: z.string().trim().min(2, "Give the period a name, like 2027").max(40), startsOn: isoDate, endsOn: isoDate })
  .refine((v) => v.endsOn >= v.startsOn, { path: ["endsOn"], message: "End must be on or after the start" });

export const churchSchema = z.object({ name: z.string().trim().min(2, "Enter the church's name").max(80) });

export const quotasSchema = z.object({
  periodId: z.uuid(),
  quotas: z.array(z.object({ churchId: z.uuid(), amount: kshAmount })).min(1, "Change at least one quota").max(100),
});

/** Kenyan mobile numbers in any common form -> +2547XXXXXXXX / +2541XXXXXXXX. Empty means none. */
export const kenyanPhone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .refine((v) => v === "" || /^(\+?254|0)?[17]\d{8}$/.test(v), "Use a Kenyan mobile number like 0712 345 678")
  .transform((v) => (v === "" ? null : `+254${v.slice(-9)}`));

export const parishionerSchema = z.object({
  displayName: z.string().trim().min(2, "Enter the parishioner's name").max(120),
  churchId: z.uuid("Choose their church"),
  household: z.string().trim().max(80).optional(),
  phone: kenyanPhone.optional(),
});

export type PeriodInput = z.input<typeof periodSchema>;
export type ChurchInput = z.input<typeof churchSchema>;
export type QuotasInput = z.input<typeof quotasSchema>;
export type ParishionerInput = z.input<typeof parishionerSchema>;
