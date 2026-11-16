import { z } from "zod";
import { isoDate } from "./money";

/** One row as the browser parsed it. The server re-checks everything. */
export const importRowSchema = z.object({
  line: z.number().int().positive(),
  date: isoDate,
  name: z.string().trim().min(1).max(120),
  amountCents: z.number().int().positive().max(100_000_000_00),
  method: z.enum(["mpesa", "cash"]),
  reference: z.string().trim().max(40),
});

export const importSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  rows: z.array(importRowSchema).min(1, "No rows to import").max(2000, "Import at most 2,000 rows at a time"),
});

export type ImportRow = z.infer<typeof importRowSchema>;
export type ImportInput = z.input<typeof importSchema>;
