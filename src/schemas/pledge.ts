import { z } from "zod";
import { isoDate, kshAmount } from "./money";

export const setPledgeSchema = z.object({
  parishionerId: z.uuid(),
  periodId: z.uuid(),
  amount: kshAmount,
  effectiveFrom: isoDate,
  idempotencyKey: z.uuid(),
});

export type SetPledgeInput = z.input<typeof setPledgeSchema>;
