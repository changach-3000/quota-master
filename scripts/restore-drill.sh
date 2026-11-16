#!/usr/bin/env bash
# Restore drill: proves a backup can actually be restored.
#
#   npm run db:restore-drill               # newest backup
#   npm run db:restore-drill -- <file.qmb>
#
# 1. Checks the file's SHA-256 and decrypts it (gpg also detects tampering).
# 2. Restores into a brand-new throwaway database on the same server.
# 3. Compares row counts and money totals with the manifest taken at backup.
# 4. Checks the integrity rules came back: append-only ledger and audit log.
# 5. Drops the throwaway database (KEEP_DRILL_DB=1 keeps it) and appends the
#    result to backups/drill-log.txt.
# Never touches the live database except to create/drop the drill copy.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
source scripts/db-lib.sh
load_env
require_passphrase
: "${DATABASE_URL:?DATABASE_URL must be set}"

PG="$(pg_bin)"
OUT_DIR="${BACKUP_DIR:-backups}"
FILE="${1:-$(ls -1t "$OUT_DIR"/*.qmb 2>/dev/null | head -n1 || true)}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "No backup found. Run npm run db:backup first." >&2; exit 1; }

DRILL_DB="quota_master_drill_$(date -u +%Y%m%d%H%M%S)"
case "$DRILL_DB" in *_drill_*) ;; *) echo "refusing: drill database name must contain _drill_" >&2; exit 1 ;; esac
ADMIN_URL="$(url_with_db "$DATABASE_URL" postgres)"
DRILL_URL="$(url_with_db "$DATABASE_URL" "$DRILL_DB")"
WORK="$(mktemp -d)"
RESULT="FAIL"
started=$(date +%s)

cleanup() {
  rm -rf "$WORK"
  if [ "${KEEP_DRILL_DB:-0}" != "1" ]; then
    "$PG/psql" -X -q -d "$ADMIN_URL" -c "DROP DATABASE IF EXISTS \"$DRILL_DB\"" >/dev/null 2>&1 || true
  fi
  mkdir -p "$OUT_DIR"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $RESULT $(basename "$FILE") $(( $(date +%s) - started ))s" >> "$OUT_DIR/drill-log.txt"
}
trap cleanup EXIT

echo "Restore drill for $FILE"

echo "1/4 Checking checksum and decrypting"
(cd "$(dirname "$FILE")" && shasum -a 256 -c "$(basename "$FILE").sha256" >/dev/null) || { echo "Checksum mismatch: the backup file has changed." >&2; exit 1; }
gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$FILE" 3<<<"$BACKUP_PASSPHRASE" | tar -C "$WORK" -xf -

echo "2/4 Restoring into $DRILL_DB"
"$PG/psql" -X -q -v ON_ERROR_STOP=1 -d "$ADMIN_URL" -c "CREATE DATABASE \"$DRILL_DB\"" >/dev/null
"$PG/pg_restore" --no-owner --no-privileges --exit-on-error -d "$DRILL_URL" "$WORK/db.dump"

echo "3/4 Comparing with the manifest"
grep -E '^(count|sum|max)\.' "$WORK/manifest.txt" > "$WORK/expected.txt"
fingerprint "$DRILL_URL" > "$WORK/actual.txt"
if ! diff -u "$WORK/expected.txt" "$WORK/actual.txt"; then
  echo "Restored data does not match the backup manifest." >&2
  exit 1
fi
echo "    $(wc -l < "$WORK/expected.txt" | tr -d ' ') figures match"

echo "4/4 Checking the integrity rules survived"
for stmt in "UPDATE contributions SET amount_cents = amount_cents" "DELETE FROM audit_log"; do
  if "$PG/psql" -X -q -v ON_ERROR_STOP=1 -d "$DRILL_URL" -c "BEGIN; $stmt; ROLLBACK;" >/dev/null 2>&1; then
    echo "Integrity check failed: '$stmt' was allowed in the restored database." >&2
    exit 1
  fi
done
echo "    ledger and audit log are still append-only"

RESULT="PASS"
echo "PASS: $(basename "$FILE") restores completely ($(grep '^count.contributions' "$WORK/expected.txt" | cut -d'|' -f2) contributions)."
