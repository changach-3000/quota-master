#!/usr/bin/env bash
# Shared helpers for the backup and restore-drill scripts.

# Load KEY=value lines from .env.local then .env (like Next.js) without
# overriding anything already set in the environment.
load_env() {
  local file line key val
  for file in .env.local .env; do
    [ -f "$file" ] || continue
    while IFS= read -r line || [ -n "$line" ]; do
      [[ "$line" =~ ^[A-Z_][A-Z0-9_]*= ]] || continue
      key="${line%%=*}"
      val="${line#*=}"
      val="${val%\"}"; val="${val#\"}"
      if [ -z "${!key:-}" ]; then export "$key=$val"; fi
    done < "$file"
  done
}

# Postgres client tools must match the server's major version (16).
pg_bin() {
  if [ -n "${PG_BIN:-}" ]; then echo "$PG_BIN"
  elif [ -x /usr/local/opt/postgresql@16/bin/pg_dump ]; then echo /usr/local/opt/postgresql@16/bin
  elif [ -x /opt/homebrew/opt/postgresql@16/bin/pg_dump ]; then echo /opt/homebrew/opt/postgresql@16/bin
  else dirname "$(command -v pg_dump)"
  fi
}

require_passphrase() {
  if [ "${#BACKUP_PASSPHRASE}" -lt 16 ]; then
    echo "BACKUP_PASSPHRASE must be set (16+ characters) in the environment or .env.local" >&2
    exit 1
  fi
}

# Same database server, different database name.
url_with_db() {
  node -e 'const u = new URL(process.argv[1]); u.pathname = "/" + process.argv[2]; console.log(u.toString())' "$1" "$2"
}

db_name_of() {
  node -e 'console.log(decodeURIComponent(new URL(process.argv[1]).pathname.slice(1)))' "$1"
}

# A fingerprint of what matters: row counts and money totals. Volatile auth
# tables (sessions, sign-in attempts) are deliberately left out.
fingerprint() {
  "$(pg_bin)/psql" -X -q -A -t -v ON_ERROR_STOP=1 -d "$1" <<'SQL'
SELECT 'count.' || t, n FROM (
  SELECT 'quota_periods' AS t, count(*) AS n FROM quota_periods UNION ALL
  SELECT 'churches', count(*) FROM churches UNION ALL
  SELECT 'church_quotas', count(*) FROM church_quotas UNION ALL
  SELECT 'households', count(*) FROM households UNION ALL
  SELECT 'parishioners', count(*) FROM parishioners UNION ALL
  SELECT 'users', count(*) FROM users UNION ALL
  SELECT 'pledges', count(*) FROM pledges UNION ALL
  SELECT 'contributions', count(*) FROM contributions UNION ALL
  SELECT 'deposits', count(*) FROM deposits UNION ALL
  SELECT 'deposit_items', count(*) FROM deposit_items UNION ALL
  SELECT 'audit_log', count(*) FROM audit_log UNION ALL
  SELECT 'user_tokens', count(*) FROM user_tokens UNION ALL
  SELECT 'migrations', count(*) FROM _prisma_migrations
) x
UNION ALL SELECT 'sum.ledger_net_cents', COALESCE(sum(CASE kind WHEN 'payment' THEN amount_cents ELSE -amount_cents END), 0) FROM contributions
UNION ALL SELECT 'sum.deposits_cents', COALESCE(sum(amount_cents), 0) FROM deposits
UNION ALL SELECT 'sum.quotas_cents', COALESCE(sum(amount_cents), 0) FROM church_quotas
UNION ALL SELECT 'sum.outstanding_cents', COALESCE(sum(outstanding_cents), 0) FROM parishioner_balances
UNION ALL SELECT 'max.audit_log_id', COALESCE(max(id), 0) FROM audit_log
ORDER BY 1;
SQL
}
