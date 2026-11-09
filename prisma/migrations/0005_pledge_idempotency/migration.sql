-- Pledge changes get the same retry protection as payments and deposits:
-- resubmitting the same form returns the version it already created.
-- Seeded and older rows have no key (NULLs don't clash under UNIQUE).
ALTER TABLE pledges ADD COLUMN idempotency_key text;
ALTER TABLE pledges ADD CONSTRAINT pledges_idempotency_key_key UNIQUE (idempotency_key);
