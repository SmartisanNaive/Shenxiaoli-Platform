#!/usr/bin/env bash
set -euo pipefail
umask 077

if ! command -v restic >/dev/null 2>&1; then
  echo "Install restic before running encrypted backups." >&2
  exit 1
fi
if [[ -z "${RESTIC_REPOSITORY:-}" || -z "${RESTIC_PASSWORD_FILE:-}" ]]; then
  echo "Set RESTIC_REPOSITORY and RESTIC_PASSWORD_FILE in the environment." >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_set="./backups/backup-set-${timestamp}"
mkdir -p "$backup_set"
cleanup() {
  rm -rf "$backup_set"
}
trap cleanup EXIT

docker compose exec -T api bun run src/backup.ts - > "${backup_set}/database.sqlite"
docker compose exec -T api sh -c 'tar -czf - -C "$UPLOADS_PATH" .' > "${backup_set}/uploads.tar.gz"
restic backup "$backup_set" --tag shenxiaoli
restic forget --tag shenxiaoli --keep-daily 30 --prune
echo "Encrypted SQLite and upload backup completed: ${timestamp}"
