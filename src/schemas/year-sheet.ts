import { z } from "zod";
import { isoDate } from "./money";

// The treasurer's yearly sheet: one row per person with their quota (pledge),
// a run of instalment cells (amounts, "-M" meaning M-Pesa), a total and remarks.

export const yearSheetInstalmentSchema = z.object({
  column: z.number().int().min(0).max(200),
  amountCents: z.number().int().positive().max(100_000_000_00),
  method: z.enum(["mpesa", "cash"]),
  /** A real date the treasurer typed in during review, or null for "date not recorded". */
  date: isoDate.nullable(),
});

export const yearSheetRowSchema = z.object({
  line: z.number().int().positive(),
  name: z.string().trim().min(2).max(120),
  quotaCents: z.number().int().min(0).max(100_000_000_00).nullable(),
  instalments: z.array(yearSheetInstalmentSchema).max(50),
});

export const yearSheetImportSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  periodId: z.uuid(),
  churchId: z.uuid(),
  /** Used for instalments with no real date. */
  asOfDate: isoDate,
  rows: z.array(yearSheetRowSchema).min(1, "No rows to import").max(2000),
});

export type YearSheetRow = z.infer<typeof yearSheetRowSchema>;
export type YearSheetImportInput = z.input<typeof yearSheetImportSchema>;
