import { z } from "zod";
import { isoDate, kshAmount } from "./money";

/** Same rule as the contributions_mpesa_code_format constraint. */
export const MPESA_CODE = /^[A-Z0-9]{10}$/;

export const recordPaymentSchema = z
  .object({
    parishionerId: z.uuid("Choose a parishioner"),
    method: z.enum(["mpesa", "cash"]),
    mpesaCode: z.string().trim().toUpperCase().optional(),
    receiptNo: z.string().trim().max(40).optional(),
    amount: kshAmount,
    receivedOn: isoDate,
    notes: z.string().trim().max(500).optional(),
    idempotencyKey: z.uuid(),
  })
  .superRefine((v, ctx) => {
    if (v.method === "mpesa" && !MPESA_CODE.test(v.mpesaCode ?? "")) {
      ctx.addIssue({ code: "custom", path: ["mpesaCode"], message: "M-Pesa codes are 10 letters and numbers, like SKL3XQ8T2M" });
    }
    if (v.method === "cash" && !v.receiptNo) {
      ctx.addIssue({ code: "custom", path: ["receiptNo"], message: "Enter the receipt number you wrote for this cash" });
    }
  });

export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;
