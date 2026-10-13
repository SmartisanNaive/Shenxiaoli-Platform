#!/usr/bin/env bash
set -euo pipefail
umask 077

if ! command -v restic >/dev/null 2>&1; then
  echo "Install restic before restoring backups." >&2
  exit 1
fi
if [[ -z "${RESTIC_REPOSITORY:-}" || -z "${RESTIC_PASSWORD_FILE:-}" ]]; then
  echo "Set RESTIC_REPOSITORY and RESTIC_PASSWORD_FILE in the environment." >&2
  exit 1
fi

snapshot="${1:-latest}"
restore_stage="./backups/restore-staging"
rm -rf "$restore_stage"
mkdir -p "$restore_stage"
cleanup() {
  rm -rf "$restore_stage"
}
trap cleanup EXIT

restic restore "$snapshot" --target "$restore_stage"
database_file="$(find "$restore_stage" -type f -name database.sqlite -print -quit)"
uploads_file="$(find "$restore_stage" -type f -name uploads.tar.gz -print -quit)"
if [[ -z "$database_file" || -z "$uploads_file" ]]; then
  echo "The selected snapshot does not contain a Shenxiaoli database and uploads pair." >&2
  exit 1
fi
cp "$database_file" "$restore_stage/database.sqlite"
cp "$uploads_file" "$restore_stage/uploads.tar.gz"

docker compose stop api worker
docker compose run --rm --no-deps -v "$PWD/$restore_stage:/restore:ro" api bun run src/restore.ts /restore
docker compose up -d api worker web
echo "Restore completed. The service retained pre-restore files in its data volumes for rollback."
