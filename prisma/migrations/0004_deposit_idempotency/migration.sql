-- Deposits get the same retry protection as contributions: a resubmitted form
-- carries the same key, so it can't create a second deposit. Older rows have
-- no key (NULLs don't clash under UNIQUE); every new deposit sets one.
ALTER TABLE deposits ADD COLUMN idempotency_key text;
ALTER TABLE deposits ADD CONSTRAINT deposits_idempotency_key_key UNIQUE (idempotency_key);
