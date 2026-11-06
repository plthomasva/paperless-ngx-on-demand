#!/usr/bin/env bash
# migrate-from-pi.sh
# Run this on your Raspberry Pi to migrate your existing Paperless-NGX
# database and search index to the AWS on-demand setup.
# NOTE: Because your /media directory is already mounted via s3fs in S3,
# you DO NOT need to upload gigabytes of documents! Only /data is synced.

set -euo pipefail

PI_PAPERLESS_DIR="${1:-/home/pi/paperless-ngx}"
S3_INBOX_BUCKET="${2:-}"
AWS_REGION="${3:-us-east-1}"

if [[ -z "$S3_INBOX_BUCKET" ]]; then
  echo "Usage: ./migrate-from-pi.sh <path-to-pi-paperless-dir> <s3-inbox-bucket-name> [aws-region]"
  echo "Example: ./migrate-from-pi.sh /home/pi/paperless-ngx my-paperless-inbox us-east-1"
  exit 1
fi

DATA_DIR="$PI_PAPERLESS_DIR/data"
TMP_EXPORT="/tmp/pi-paperless-export"

echo "=== Paperless-NGX Raspberry Pi to AWS Migration Helper ==="
echo "Pi Paperless directory: $PI_PAPERLESS_DIR"
echo "Target S3 Inbox bucket: $S3_INBOX_BUCKET"

if [[ ! -d "$DATA_DIR" ]]; then
  echo "Error: Directory $DATA_DIR does not exist." >&2
  exit 1
fi

echo "1. Creating safe online SQLite backup from Pi..."
rm -rf "$TMP_EXPORT"
mkdir -p "$TMP_EXPORT/data"

if [[ -f "$DATA_DIR/db.sqlite3" ]]; then
  sqlite3 "$DATA_DIR/db.sqlite3" ".backup '$TMP_EXPORT/data/db.sqlite3'"
fi

if [[ -d "$DATA_DIR/index" ]]; then
  echo "2. Copying Whoosh search index..."
  cp -a "$DATA_DIR/index" "$TMP_EXPORT/data/"
fi

if [[ -f "$DATA_DIR/classification_model.pickle" ]]; then
  echo "3. Copying document classification model..."
  cp -a "$DATA_DIR/classification_model.pickle" "$TMP_EXPORT/data/"
fi

echo "4. Packaging data directory into compressed archive..."
ARCHIVE="/tmp/paperless-data-latest.tar.gz"
tar -czf "$ARCHIVE" -C "$TMP_EXPORT/data" .

echo "5. Uploading backup to s3://${S3_INBOX_BUCKET}/backups/paperless-data-latest.tar.gz..."
aws s3 cp "$ARCHIVE" "s3://${S3_INBOX_BUCKET}/backups/paperless-data-latest.tar.gz" --region "$AWS_REGION"

rm -rf "$TMP_EXPORT" "$ARCHIVE"

echo ""
echo "=== Migration archive successfully uploaded to S3! ==="
echo "When your AWS on-demand EC2 instance boots up for the first time, its"
echo "boot-sync hook will automatically download and unpack this archive into /mnt/data."
echo "Your documents in S3 will attach automatically via s3fs on boot."

