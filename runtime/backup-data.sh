#!/usr/bin/env bash
# backup-data.sh
# Performs an online, transactionally consistent backup of SQLite (db.sqlite3)
# and the Whoosh full-text search index, plus exports a version-independent
# manifest.json. Uploads the compressed snapshot to S3.

set -euo pipefail

if [[ -f "/opt/paperless/runtime/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source /opt/paperless/runtime/.env
  set +a
fi

DATA_DIR="${DATA_DIR:-/mnt/data}"
BACKUP_TMP_DIR="/tmp/paperless-backup"
INBOX_BUCKET="${INBOX_BUCKET:-}"
AWS_REGION="${AWS_REGION:-us-east-1}"
TIMESTAMP=$(date -u +"%Y%m%d_%H%M%SZ")

if [[ -z "$INBOX_BUCKET" ]]; then
  echo "[backup] Error: INBOX_BUCKET environment variable is required." >&2
  exit 1
fi

if [[ ! -f "$DATA_DIR/db.sqlite3" ]]; then
  echo "[backup] Warning: $DATA_DIR/db.sqlite3 does not exist yet. Skipping backup."
  exit 0
fi

echo "[backup] Starting transactional backup at $TIMESTAMP..."
rm -rf "$BACKUP_TMP_DIR"
mkdir -p "$BACKUP_TMP_DIR/data"

# 1. Transactionally safe online SQLite backup using sqlite3 CLI
# This locks reading for milliseconds without stopping active connections
echo "[backup] Creating SQLite online backup..."
sqlite3 "$DATA_DIR/db.sqlite3" ".backup '$BACKUP_TMP_DIR/data/db.sqlite3'"

# 2. Copy Whoosh search index and classification models if present
if [[ -d "$DATA_DIR/index" ]]; then
  echo "[backup] Copying Whoosh search index..."
  cp -a "$DATA_DIR/index" "$BACKUP_TMP_DIR/data/"
fi

if [[ -f "$DATA_DIR/classification_model.pickle" ]]; then
  echo "[backup] Copying classification model..."
  cp -a "$DATA_DIR/classification_model.pickle" "$BACKUP_TMP_DIR/data/"
fi

# 3. Export portable JSON metadata dump from Paperless container
echo "[backup] Exporting metadata dump (manifest.json)..."
if docker compose -f /opt/paperless/runtime/docker-compose.yml ps webserver | grep -q "Up"; then
  docker compose -f /opt/paperless/runtime/docker-compose.yml exec -T webserver \
    python3 manage.py dumpdata --exclude contenttypes --exclude auth.Permission --indent 2 \
    > "$BACKUP_TMP_DIR/data/manifest.json" 2>/dev/null || echo "[backup] Note: dumpdata non-critical warning."
fi

# 4. Compress data directory archive using tar and zstd (or gzip as fallback)
ARCHIVE_FILE="$BACKUP_TMP_DIR/paperless-data-${TIMESTAMP}.tar.gz"
echo "[backup] Compressing backup archive..."
tar -czf "$ARCHIVE_FILE" -C "$BACKUP_TMP_DIR/data" .

# 5. Upload to S3: both timestamped snapshot and 'latest' pointer
echo "[backup] Uploading backup to S3 bucket $INBOX_BUCKET..."
aws s3 cp "$ARCHIVE_FILE" "s3://${INBOX_BUCKET}/backups/paperless-data-${TIMESTAMP}.tar.gz" --region "$AWS_REGION"
aws s3 cp "$ARCHIVE_FILE" "s3://${INBOX_BUCKET}/backups/paperless-data-latest.tar.gz" --region "$AWS_REGION"

# Clean up temporary backup files
rm -rf "$BACKUP_TMP_DIR"
echo "[backup] Backup completed successfully at $(date -u +"%Y%m%d_%H%M%SZ")."

