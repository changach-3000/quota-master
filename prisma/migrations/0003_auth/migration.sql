-- Authentication: server-side sessions, sign-in attempts (rate limiting and
-- lockout), and single-use tokens for invites and password resets.
--
-- Secrets are never stored: session ids and tokens are kept as SHA-256
-- hashes of the random value the browser or link holds.

CREATE TABLE sessions (
  id           text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),  -- sha256(token), hex
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,                          -- absolute limit
  ip_address   inet,
  user_agent   text CHECK (length(user_agent) <= 512),
  CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Every sign-in attempt, successful or not, keyed by normalised email and IP.
-- Lockout and rate limits are counted from here, so they apply equally to
-- emails that have no account (no account enumeration through lockouts).
CREATE TABLE sign_in_attempts (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email_lower  text NOT NULL CHECK (email_lower = lower(email_lower)),
  ip_address   inet,
  succeeded    boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sign_in_attempts_email_idx ON sign_in_attempts (email_lower, attempted_at);
CREATE INDEX sign_in_attempts_ip_idx ON sign_in_attempts (ip_address, attempted_at);

CREATE TYPE user_token_purpose AS ENUM ('invite', 'password_reset');

CREATE TABLE user_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose    user_token_purpose NOT NULL,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  CONSTRAINT user_tokens_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT user_tokens_used_in_window CHECK (used_at IS NULL OR used_at <= expires_at)
);
CREATE INDEX user_tokens_user_idx ON user_tokens (user_id);

-- A token can be used once: the only allowed update is setting used_at.
CREATE FUNCTION user_tokens_guard_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.used_at IS NOT NULL
     OR NEW.used_at IS NULL
     OR (to_jsonb(NEW) - 'used_at') IS DISTINCT FROM (to_jsonb(OLD) - 'used_at') THEN
    RAISE EXCEPTION 'user tokens are single-use and otherwise immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_tokens_guard_update BEFORE UPDATE ON user_tokens
  FOR EACH ROW EXECUTE FUNCTION user_tokens_guard_update();

ALTER TABLE users ADD COLUMN password_changed_at timestamptz;
