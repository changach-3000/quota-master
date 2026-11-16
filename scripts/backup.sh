#!/usr/bin/env bash
# Encrypted database backup.
#
#   npm run db:backup
#
# Writes backups/quota_master-<UTC time>.qmb (gpg AES-256, symmetric) and a
# .sha256 beside it. Inside: a pg_dump custom-format archive and a manifest
# of row counts and money totals that the restore drill checks against.
# Sessions and sign-in attempts are not backed up: restoring them would
# revive old sign-ins. Keeps the newest $BACKUP_KEEP backups (default 14).
#
# Needs DATABASE_URL and BACKUP_PASSPHRASE (env or .env.local). Store the
# passphrase somewhere other than the machine holding the backups.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
source scripts/db-lib.sh
load_env
require_passphrase
: "${DATABASE_URL:?DATABASE_URL must be set}"

PG="$(pg_bin)"
KEEP="${BACKUP_KEEP:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB="$(db_name_of "$DATABASE_URL")"
OUT_DIR="${BACKUP_DIR:-backups}"
OUT="$OUT_DIR/${DB}-${STAMP}.qmb"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT_DIR"

echo "Backing up $DB with $("$PG/pg_dump" --version)"

{
  echo "database=$DB"
  echo "created_utc=$STAMP"
  echo "pg_dump=$("$PG/pg_dump" --version)"
  fingerprint "$DATABASE_URL"
} > "$WORK/manifest.txt"

"$PG/pg_dump" --format=custom --no-owner --no-privileges \
  --exclude-table-data=sessions --exclude-table-data=sign_in_attempts \
  --file="$WORK/db.dump" "$DATABASE_URL"

# The passphrase goes in on a file descriptor, never on the command line (visible in `ps`).
tar -C "$WORK" -cf - manifest.txt db.dump \
  | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
        --symmetric --cipher-algo AES256 --compress-algo none --output "$OUT.tmp" 3<<<"$BACKUP_PASSPHRASE"
mv "$OUT.tmp" "$OUT"
(cd "$OUT_DIR" && shasum -a 256 "$(basename "$OUT")" > "$(basename "$OUT").sha256")

echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"

# Retention: newest $KEEP backups stay.
ls -1t "$OUT_DIR"/"$DB"-*.qmb 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f "$old" "$old.sha256"
  echo "Removed old backup $old"
done
