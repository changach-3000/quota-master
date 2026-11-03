-- Quota Master: initial schema (SQL-first; Prisma reads it via `db pull`).
--
-- Principles:
--   * Money is bigint cents (KSh * 100). Never floats.
--   * contributions and audit_log are append-only: no UPDATE, DELETE or TRUNCATE.
--   * Corrections are reversal rows; balances are derived (view), never stored.
--   * The database enforces integrity; the app is not trusted to.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE user_role         AS ENUM ('admin', 'treasurer', 'auditor', 'member');
CREATE TYPE payment_method    AS ENUM ('mpesa', 'cash');
CREATE TYPE contribution_kind AS ENUM ('payment', 'reversal');

-- Shared guard used by every append-only table.
CREATE FUNCTION forbid_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- ---------------------------------------------------------------------------
-- Quota periods
-- ---------------------------------------------------------------------------
CREATE TABLE quota_periods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  starts_on  date NOT NULL,
  ends_on    date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quota_periods_range_valid CHECK (ends_on >= starts_on),
  CONSTRAINT quota_periods_no_overlap
    EXCLUDE USING gist (daterange(starts_on, ends_on, '[]') WITH &&)
);

-- ---------------------------------------------------------------------------
-- Churches and their quotas
-- ---------------------------------------------------------------------------
CREATE TABLE churches (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE church_quotas (
  church_id    uuid   NOT NULL REFERENCES churches (id),
  period_id    uuid   NOT NULL REFERENCES quota_periods (id),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (church_id, period_id)
);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
CREATE TABLE households (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id  uuid NOT NULL REFERENCES churches (id),
  label      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (church_id, label)
);

CREATE TABLE parishioners (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id    uuid NOT NULL REFERENCES churches (id),
  household_id uuid REFERENCES households (id),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  phone        text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX parishioners_church_idx ON parishioners (church_id);

CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL CHECK (position('@' IN email) > 1),
  password_hash      text,            -- Argon2id encoded string; null until invite accepted
  role               user_role NOT NULL,
  parishioner_id     uuid UNIQUE REFERENCES parishioners (id),
  is_active          boolean NOT NULL DEFAULT true,
  failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_member_has_parishioner
    CHECK (role <> 'member' OR parishioner_id IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

-- ---------------------------------------------------------------------------
-- Pledges (versioned: a change inserts a new row and retires the old one)
-- ---------------------------------------------------------------------------
CREATE TABLE pledges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parishioner_id uuid    NOT NULL REFERENCES parishioners (id),
  period_id      uuid    NOT NULL REFERENCES quota_periods (id),
  amount_cents   bigint  NOT NULL CHECK (amount_cents >= 0),
  version        integer NOT NULL CHECK (version >= 1),
  effective_from date    NOT NULL,
  is_current     boolean NOT NULL DEFAULT true,
  supersedes_id  uuid REFERENCES pledges (id),
  created_by     uuid REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parishioner_id, period_id, version)
);
CREATE UNIQUE INDEX pledges_one_current_key
  ON pledges (parishioner_id, period_id) WHERE is_current;

-- The only permitted change to a pledge is retiring it (is_current true -> false).
CREATE FUNCTION pledges_guard_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'is_current') IS DISTINCT FROM (to_jsonb(OLD) - 'is_current')
     OR NOT (OLD.is_current AND NOT NEW.is_current) THEN
    RAISE EXCEPTION 'pledges are versioned: insert a new version instead of editing'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pledges_guard_update BEFORE UPDATE ON pledges
  FOR EACH ROW EXECUTE FUNCTION pledges_guard_update();
CREATE TRIGGER pledges_no_delete BEFORE DELETE ON pledges
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();

-- ---------------------------------------------------------------------------
-- Contributions (append-only ledger)
-- Payments and reversals share the table. Amounts are always positive;
-- kind decides the sign when balances are derived.
-- ---------------------------------------------------------------------------
CREATE TABLE contributions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            contribution_kind NOT NULL,
  parishioner_id  uuid   NOT NULL REFERENCES parishioners (id),
  period_id       uuid   NOT NULL REFERENCES quota_periods (id),
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  method          payment_method,
  mpesa_code      text,
  receipt_no      text,
  received_on     date   NOT NULL,
  reverses_id     uuid,
  reason          text,
  idempotency_key text   NOT NULL,
  recorded_by     uuid REFERENCES users (id),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  notes           text,

  CONSTRAINT contributions_idempotency_key_key UNIQUE (idempotency_key),
  CONSTRAINT contributions_mpesa_code_key      UNIQUE (mpesa_code),
  CONSTRAINT contributions_reverses_id_key     UNIQUE (reverses_id),
  -- Target for the reversal composite FK below.
  CONSTRAINT contributions_reversal_target_key
    UNIQUE (id, parishioner_id, period_id, amount_cents),

  -- A reversal must match its original's parishioner, period and amount.
  CONSTRAINT contributions_reversal_matches_original
    FOREIGN KEY (reverses_id, parishioner_id, period_id, amount_cents)
    REFERENCES contributions (id, parishioner_id, period_id, amount_cents),

  CONSTRAINT contributions_payment_shape CHECK (
    kind <> 'payment' OR (method IS NOT NULL AND reverses_id IS NULL)
  ),
  CONSTRAINT contributions_reversal_shape CHECK (
    kind <> 'reversal' OR (
      reverses_id IS NOT NULL
      AND method IS NULL AND mpesa_code IS NULL AND receipt_no IS NULL
      AND reason IS NOT NULL AND btrim(reason) <> ''
    )
  ),
  CONSTRAINT contributions_mpesa_requires_code CHECK (
    method IS DISTINCT FROM 'mpesa' OR mpesa_code IS NOT NULL
  ),
  -- Codes are stored normalised (upper case, 10 alphanumerics) so uniqueness is real.
  CONSTRAINT contributions_mpesa_code_format CHECK (
    mpesa_code IS NULL OR mpesa_code ~ '^[A-Z0-9]{10}$'
  ),
  CONSTRAINT contributions_cash_requires_receipt CHECK (
    method IS DISTINCT FROM 'cash' OR (receipt_no IS NOT NULL AND btrim(receipt_no) <> '')
  )
);
CREATE INDEX contributions_parishioner_period_idx ON contributions (parishioner_id, period_id);
CREATE INDEX contributions_received_on_idx ON contributions (received_on);

-- A reversal may only target a payment, never another reversal.
CREATE FUNCTION contributions_guard_reversal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reverses_id IS NOT NULL
     AND (SELECT kind FROM contributions WHERE id = NEW.reverses_id) = 'reversal' THEN
    RAISE EXCEPTION 'cannot reverse a reversal (contribution %)', NEW.reverses_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER contributions_guard_reversal BEFORE INSERT ON contributions
  FOR EACH ROW EXECUTE FUNCTION contributions_guard_reversal();

CREATE TRIGGER contributions_no_update_delete BEFORE UPDATE OR DELETE ON contributions
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER contributions_no_truncate BEFORE TRUNCATE ON contributions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

-- ---------------------------------------------------------------------------
-- Bank deposits
-- ---------------------------------------------------------------------------
CREATE TABLE deposits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposited_on date   NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  bank_account text   NOT NULL DEFAULT 'NCBA',
  bank_ref     text,
  recorded_by  uuid REFERENCES users (id),
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  notes        text
);

CREATE TABLE deposit_items (
  deposit_id      uuid NOT NULL REFERENCES deposits (id),
  contribution_id uuid NOT NULL REFERENCES contributions (id),
  PRIMARY KEY (deposit_id, contribution_id),
  -- A contribution is in at most one deposit.
  CONSTRAINT deposit_items_contribution_key UNIQUE (contribution_id)
);

-- Only payments can be deposited.
CREATE FUNCTION deposit_items_guard_kind() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT kind FROM contributions WHERE id = NEW.contribution_id) <> 'payment' THEN
    RAISE EXCEPTION 'only payments can be deposited (contribution %)', NEW.contribution_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER deposit_items_guard_kind BEFORE INSERT OR UPDATE ON deposit_items
  FOR EACH ROW EXECUTE FUNCTION deposit_items_guard_kind();

-- A deposit's amount must equal the sum of its items, checked at COMMIT so the
-- deposit and its items can be inserted in either order inside one transaction.
CREATE FUNCTION deposits_check_total() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  dep_id   uuid;
  expected bigint;
  actual   bigint;
BEGIN
  -- Separate branches: PL/pgSQL resolves every field reference in an expression.
  IF TG_TABLE_NAME = 'deposits' THEN
    dep_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    dep_id := OLD.deposit_id;
  ELSE
    dep_id := NEW.deposit_id;
  END IF;
  SELECT amount_cents INTO expected FROM deposits WHERE id = dep_id;
  IF expected IS NULL THEN
    RETURN NULL;  -- deposit row gone; FK handles orphans
  END IF;
  SELECT COALESCE(sum(c.amount_cents), 0) INTO actual
    FROM deposit_items di JOIN contributions c ON c.id = di.contribution_id
   WHERE di.deposit_id = dep_id;
  IF actual <> expected THEN
    RAISE EXCEPTION 'deposit % amount % does not equal sum of its items %', dep_id, expected, actual
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER deposits_check_total
  AFTER INSERT OR UPDATE ON deposits
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION deposits_check_total();
CREATE CONSTRAINT TRIGGER deposit_items_check_total
  AFTER INSERT OR UPDATE OR DELETE ON deposit_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION deposits_check_total();

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users (id),
  action        text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     text,
  before_data   jsonb,
  after_data    jsonb,
  is_backdated  boolean NOT NULL DEFAULT false,
  request_id    text,
  ip_address    inet
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_occurred_at_idx ON audit_log (occurred_at);

CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

-- ---------------------------------------------------------------------------
-- Derived balances (never stored)
-- One row per parishioner and period that has a current pledge or any contribution.
-- ---------------------------------------------------------------------------
CREATE VIEW parishioner_balances AS
WITH received AS (
  SELECT parishioner_id, period_id,
         sum(CASE kind WHEN 'payment' THEN amount_cents ELSE -amount_cents END)::bigint AS received_cents
    FROM contributions
   GROUP BY parishioner_id, period_id
),
pledged AS (
  SELECT parishioner_id, period_id, amount_cents AS pledged_cents
    FROM pledges
   WHERE is_current
)
SELECT k.parishioner_id,
       k.period_id,
       COALESCE(p.pledged_cents, 0)::bigint  AS pledged_cents,
       COALESCE(r.received_cents, 0)::bigint AS received_cents,
       GREATEST(COALESCE(p.pledged_cents, 0) - COALESCE(r.received_cents, 0), 0)::bigint AS outstanding_cents,
       GREATEST(COALESCE(r.received_cents, 0) - COALESCE(p.pledged_cents, 0), 0)::bigint AS credit_cents
  FROM (SELECT parishioner_id, period_id FROM pledged
        UNION
        SELECT parishioner_id, period_id FROM received) k
  LEFT JOIN pledged  p USING (parishioner_id, period_id)
  LEFT JOIN received r USING (parishioner_id, period_id);
