-- Prisma models the reversal self-reference as one-to-one only when the
-- referencing columns are unique together. Because the composite FK already
-- forces a reversal to carry its original's parishioner, period and amount,
-- uniqueness on all four columns is equivalent to uniqueness on reverses_id:
-- a payment still gets at most one reversal.
ALTER TABLE contributions DROP CONSTRAINT contributions_reverses_id_key;
ALTER TABLE contributions ADD CONSTRAINT contributions_reverses_id_key
  UNIQUE (reverses_id, parishioner_id, period_id, amount_cents);
