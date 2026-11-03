import { z } from "zod";

// Shared by forms (client) and, later, server actions. Mirrors the database
// rules so the user hears about a problem before the database rejects it.

/** "12,500" / "12500.50" (KSh) -> 1250050 cents. */
export const kshAmount = z
  .string()
  .trim()
  .min(1, "Enter an amount")
  .transform((v) => v.replace(/,/g, ""))
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "Enter an amount in shillings, like 2500 or 2500.50")
  .transform((v) => Math.round(Number(v) * 100))
  .refine((cents) => cents > 0, "Amount must be more than zero")
  .refine((cents) => cents <= 100_000_000_00, "That amount looks too large; check it");

export const isoDate = z.iso.date("Enter a valid date");
