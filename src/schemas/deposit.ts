import { z } from "zod";
import { isoDate, kshAmount } from "./money";

export const recordDepositSchema = z.object({
  contributionIds: z
    .array(z.uuid())
    .min(1, "Select the payments that went into this deposit")
    .max(2000, "That is more payments than one deposit should hold")
    .refine((ids) => new Set(ids).size === ids.length, "A payment is selected twice"),
  depositedOn: isoDate,
  slipAmount: kshAmount,
  bankRef: z.string().trim().max(60).optional(),
  idempotencyKey: z.uuid(),
});

export type RecordDepositInput = z.input<typeof recordDepositSchema>;
