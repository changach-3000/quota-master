-- Historical payments: brought in from the treasurer's paper/Excel records,
-- which have no M-Pesa codes, no receipt numbers and often no dates.
--
--   is_historical       the payment came from an old record, so it may lack
--                       a code or receipt; it was banked long ago and is never
--                       part of a new deposit.
--   date_is_estimated   received_on is an "as at" date, not the real day.
--
-- Everything typed into the app from now on keeps the strict rules.

ALTER TABLE contributions ADD COLUMN is_historical boolean NOT NULL DEFAULT false;
ALTER TABLE contributions ADD COLUMN date_is_estimated boolean NOT NULL DEFAULT false;

ALTER TABLE contributions DROP CONSTRAINT contributions_mpesa_requires_code;
ALTER TABLE contributions ADD CONSTRAINT contributions_mpesa_requires_code CHECK (
  method IS DISTINCT FROM 'mpesa' OR mpesa_code IS NOT NULL OR is_historical
);

ALTER TABLE contributions DROP CONSTRAINT contributions_cash_requires_receipt;
ALTER TABLE contributions ADD CONSTRAINT contributions_cash_requires_receipt CHECK (
  method IS DISTINCT FROM 'cash' OR (receipt_no IS NOT NULL AND btrim(receipt_no) <> '') OR is_historical
);

-- Only payments can be historical; an estimated date only makes sense on one.
ALTER TABLE contributions ADD CONSTRAINT contributions_historical_shape CHECK (
  (NOT is_historical OR kind = 'payment') AND (NOT date_is_estimated OR is_historical)
);

-- Historical payments were banked long ago, outside the app: never deposit them again.
CREATE OR REPLACE FUNCTION deposit_items_guard_kind() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  c record;
BEGIN
  SELECT kind, is_historical INTO c FROM contributions WHERE id = NEW.contribution_id;
  IF c.kind <> 'payment' THEN
    RAISE EXCEPTION 'only payments can be deposited (contribution %)', NEW.contribution_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF c.is_historical THEN
    RAISE EXCEPTION 'historical payments were banked before the app and cannot be deposited (contribution %)', NEW.contribution_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
