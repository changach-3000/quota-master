# Quota Master

Church quota and contribution tracking for a Kenyan parish. Each church in the
parish has a quota for the year; the treasurer sets parishioners' pledges,
records M-Pesa and cash payments, banks them in NCBA deposits, and reports
progress. Members can see their own giving and their church's totals, and
nothing about anyone else.

> **Status: demo on synthetic data. Not approved for real parish money.**
> Before any real money is recorded, three things must pass: a parallel run
> against the treasurer's spreadsheet, a restore drill on the production
> database, and the full permission test suite against the deployed app.

## What it does

| For the treasurer | For members |
|---|---|
| Dashboard: collected vs quota, undeposited cash, outstanding pledges, reversals, trends | Own pledge, payments and balance |
| Record payments (M-Pesa code or cash receipt); reverse with a reason | Church totals and monthly trend (no names, no rankings) |
| Bank deposits: tick payments, match the slip | Statement download (CSV) |
| Versioned pledges; church quotas per period | Change password, update phone |
| Reports with CSV export and print; append-only audit log | |
| Import the yearly quota sheet (.xlsx or CSV) or a payment list, with a dry run; safe to re-run | |

Roles: **admin**, **treasurer**, **auditor** (sees everything, changes nothing), **member**.

## Quick start (macOS, development)

Needs Node 20.19+, and PostgreSQL 16 from Homebrew on port 5434 (5432 and 5433
may already be in use on this machine).

```bash
brew install postgresql@16
sed -i '' 's/^#port = 5432/port = 5434/' /usr/local/var/postgresql@16/postgresql.conf
brew services start postgresql@16
createdb -p 5434 quota_master && createdb -p 5434 quota_master_test

npm install
cp .env.example .env.local   # then set your Mac user name and the two secrets
npx prisma migrate deploy
npx prisma generate
npx prisma db seed           # synthetic data: 3 churches, 130 parishioners, 2025–2026
npm run dev                  # http://localhost:3000
```

With `DEV_LOGIN=1`, the sign-in page lists **demo accounts** (admin, treasurer,
auditor, members) that sign in with one click. They also accept
`SEED_DEMO_PASSWORD` through the normal form. Demo sign-in is refused outside
`npm run dev`.

## Five-minute demo

1. **Sign in** as the treasurer from the demo accounts. Point out the sign-in page's privacy note.
2. **Dashboard**: collected vs the KSh 3.9M quota, the year-elapsed marker on each church, undeposited funds. Toggle the chart to *Cumulative vs quota* and hover a month.
3. **Record payment** for any parishioner with a new 10-character M-Pesa code. The toast shows their new balance, computed by the database. Record the **same code again**: it is refused, naming the original entry.
4. **Contributions**: search the code, press **Reverse**, give a reason. The original stays; a reversal is added; the net is zero. Open **Audit log** to show both entries.
5. **Deposits**: tick two payments, type the slip amount wrong (warning), then right. Waiting money drops; the dashboard agrees.
6. **Pledges**: change a pledge. The parishioner page shows version 2 current and version 1 kept.
7. **Sign out**, sign in as **member001**: own giving and church totals only. Visit `/dashboard`: redirected back.

## Architecture

- **Next.js 16** (App Router, Cache Components) with shadcn/ui (Base UI) and Tailwind 4. Server Components read through services; forms post to Server Actions.
- **`src/services/`** holds all business logic and is server-only. Every function takes the signed-in `Viewer` explicitly. Member functions take no parishioner id at all; it comes from the session.
- **PostgreSQL is the source of truth for integrity**, with a SQL-first schema in `prisma/migrations/` (Prisma introspects it):
  - contributions and the audit log are append-only (triggers block UPDATE, DELETE and TRUNCATE)
  - unique M-Pesa codes and idempotency keys
  - a reversal must match its original, and a payment can be reversed only once
  - periods can't overlap; one current pledge per person and period
  - a deposit's total is checked at commit; a payment can sit in only one deposit
- **Money is integer cents** (`bigint`), converted to text only for display.
- Balances are **derived** (the `parishioner_balances` view), never stored.

## Security

- **Passwords**: Argon2id (OWASP parameters), 12-character minimum with a common-password check.
- **Sessions**: a random token in an HttpOnly, SameSite=Lax cookie (`__Host-` prefixed and Secure in production). Only its SHA-256 hash is stored. 7-day absolute limit; 12 h idle for staff, 7 days for members. Revoked on sign-out, password change, reset or disabling the account.
- **Lockout**: 5 failures per email per 15 min (unknown emails too, so lockouts don't reveal accounts). 30 failures per IP per 15 min. Unknown email and wrong password get the same response and timing.
- **Invites and resets**: admin-issued, single-use, hashed, time-limited links. The database trigger enforces single use.
- **Authorisation** is checked server-side in every service against the specific record; auditors are read-only.
- **Writes are idempotent** (retry-safe) and audited in the same transaction. Backdated entries are flagged.
- CSV exports neutralise spreadsheet formula injection.
- In production behind a proxy, set `TRUST_PROXY=1` so client IPs are recorded and rate-limited.

Not done yet: two-step sign-in for admin/treasurer, a Content Security Policy, email delivery of invite links.

## Importing the treasurer's sheet

**Import** accepts Excel (`.xlsx`) or CSV, in two shapes:

- **Yearly sheet**: one row per person, as the treasurer keeps it now.
  - Columns are NAME, QUOTA, then each payment in its own cell, then the total and REMARKS. Amounts marked `-M` (e.g. `3200-M`) are M-Pesa; the rest are cash.
  - The QUOTA becomes the person's pledge for the year. People who don't exist yet are added to the chosen church.
  - Each payment is recorded as **Historical**: it needs no code or receipt, and it is never put in a deposit because that money was banked long ago.
  - You can type real dates during review. Payments left without one get an "as at" date and show "date not recorded".
  - The review flags rows whose payments don't add up to the total, and "CLEARED" rows that are still short.
- **Payment list**: one row per payment with date, name, amount, method and code or receipt.

Re-importing the same file never records anything twice. `samples/` holds synthetic files in both shapes. **Keep real sheets out of the repository**, and import them straight from your own copy.

## Backups and the restore drill

```bash
npm run db:backup          # backups/quota_master-<UTC>.qmb + .sha256
npm run db:restore-drill   # restores the newest backup into a throwaway DB and verifies it
```

- Backups are `pg_dump` archives encrypted with gpg (AES-256, tamper-detecting), using `BACKUP_PASSPHRASE`. Store that passphrase **away from the backups**.
- Each backup carries a manifest of row counts and money totals.
- The drill checks the checksum, decrypts, restores into `quota_master_drill_*`, compares 18 figures with the manifest, and confirms the ledger is still append-only. It then drops the copy and appends PASS/FAIL to `backups/drill-log.txt`.
- Sessions and sign-in attempts are deliberately not backed up.
- `backups/` is git-ignored. Keep 14 by default (`BACKUP_KEEP`).

## Tests

```bash
npm test
```

Runs against `quota_master_test`, which is rebuilt from the migrations on every run. The setup refuses any database whose name doesn't end in `_test`.

| File | What it proves |
|---|---|
| `tests/db/constraints.test.ts` | The database itself rejects bad data (duplicates, edits, double reversals, overlaps…) |
| `tests/services/member-privacy.test.ts` | Member A can't see member B; members can't load staff data |
| `tests/services/auth.test.ts` | Hashing, sessions and timeouts, lockout, invites, password change |
| `tests/services/payments.test.ts` | Recording, idempotency, duplicate codes and reversals, including under concurrency |
| `tests/services/deposits.test.ts` | Slip matching, double-banking races, idempotency |
| `tests/services/pledges.test.ts` | Versioning, concurrent edits |
| `tests/services/settings.test.ts` | Quotas, periods, churches, parishioners, a member's own phone |

## Open questions (for the treasurer)

- A payment recorded against the wrong person can't be re-entered with the same M-Pesa code after reversal, because codes are unique across the ledger.
- Should reversing a payment that is already in a bank deposit be allowed? It is allowed now, with a warning and an audit flag.
- How M-Pesa money moves to NCBA, and what statement formats exist (for reconciliation).
- The real spreadsheet layout, for the importer.

Use anonymised samples only. Keep real names and amounts out of the repository.
