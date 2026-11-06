#!/usr/bin/env bash
# boot-sync.sh
# Runs at EC2 system boot. Mounts s3fs, restores /data from S3 if missing,
# starts Docker Compose, verifies Paperless is healthy, and updates CloudFront
# KeyValueStore to route traffic to this instance.

set -euo pipefail

MEDIA_BUCKET="${MEDIA_BUCKET:-}"
MEDIA_SUBPATH="${MEDIA_SUBPATH:-media}"
INBOX_BUCKET="${INBOX_BUCKET:-}"
KVS_NAME="${KVS_NAME:-}"
AWS_REGION="${AWS_REGION:-us-east-1}"
COMPOSE_FILE="/opt/paperless/runtime/docker-compose.yml"

log() {
  echo "[boot-sync $(date -u +'%Y-%m-%d %H:%M:%SZ')] $*"
}

log "Starting Paperless-NGX boot initialization..."

# 1. Create required directories
mkdir -p /mnt/data /mnt/paperless-media /mnt/consume /mnt/export /tmp/paperless /var/cache/s3fs
chmod 777 /tmp/paperless
chown -R 1000:1000 /mnt/data /mnt/consume /mnt/export /tmp/paperless

# 2. Restore SQLite and search index from S3 if /mnt/data is empty
PENDING_LOADDATA=false
if [[ ! -f "/mnt/data/db.sqlite3" ]] && [[ -n "$INBOX_BUCKET" ]]; then
  log "Database /mnt/data/db.sqlite3 not found. Checking S3 for backups or data.json..."
  if aws s3 ls "s3://${INBOX_BUCKET}/backups/paperless-data-latest.tar.gz" --region "$AWS_REGION" >/dev/null 2>&1; then
    log "Restoring data from s3://${INBOX_BUCKET}/backups/paperless-data-latest.tar.gz..."
    aws s3 cp "s3://${INBOX_BUCKET}/backups/paperless-data-latest.tar.gz" /tmp/paperless-data-latest.tar.gz --region "$AWS_REGION"
    tar -xzf /tmp/paperless-data-latest.tar.gz -C /mnt/data/
    rm -f /tmp/paperless-data-latest.tar.gz
    chown -R 1000:1000 /mnt/data
    log "Restore complete."
  elif aws s3 ls "s3://${INBOX_BUCKET}/export/data.json" --region "$AWS_REGION" >/dev/null 2>&1; then
    log "Found exported data.json in S3! Downloading for initial SQLite import..."
    aws s3 cp "s3://${INBOX_BUCKET}/export/data.json" /tmp/data.json --region "$AWS_REGION"
    chmod 666 /tmp/data.json
    PENDING_LOADDATA=true
  else
    log "No existing backup or export found in S3. Starting with fresh database."
  fi
fi

# 3. Mount S3 Media Bucket via s3fs if not already mounted
if [[ -n "$MEDIA_BUCKET" ]] && ! mountpoint -q /mnt/paperless-media; then
  s3_target="$MEDIA_BUCKET"
  if [[ -n "$MEDIA_SUBPATH" ]]; then
    s3_target="${MEDIA_BUCKET}:/${MEDIA_SUBPATH}"
  fi
  log "Mounting S3 target '$s3_target' at /mnt/paperless-media via s3fs..."
  s3fs "$s3_target" /mnt/paperless-media \
    -o iam_role=auto \
    -o endpoint="$AWS_REGION" \
    -o use_cache=/var/cache/s3fs \
    -o max_stat_cache_size=100000 \
    -o stat_cache_expire=86400 \
    -o allow_other \
    -o uid=1000,gid=1000 \
    -o multireq_max=5
  log "s3fs mount successful."
fi

# 4. Pull any incoming documents from S3 Inbox
if [[ -n "$INBOX_BUCKET" ]]; then
  log "Checking for pending documents in s3://${INBOX_BUCKET}/consume/..."
  aws s3 mv "s3://${INBOX_BUCKET}/consume/" "/mnt/consume/" --recursive --region "$AWS_REGION" 2>/dev/null || true
fi

# 5. Start Docker Compose services
log "Starting Docker Compose services..."
docker compose -f "$COMPOSE_FILE" up -d

# 6. Wait for Paperless webserver and Nginx activity proxy to become healthy
log "Waiting for Paperless-NGX to report ready on port 8000..."
max_wait=120
waited=0
while [[ "$waited" -lt "$max_wait" ]]; do
  # Check if Nginx health endpoint responds and Paperless API responds
  if curl -sf -m 2 http://127.0.0.1:8000/__health >/dev/null 2>&1; then
    status_code=$(curl -s -o /dev/null -w "%{http_code}" -m 2 http://127.0.0.1:8080/api/ || echo 000)
    if [[ "$status_code" =~ ^(200|401|403)$ ]]; then
      log "Paperless-NGX is ready! (HTTP $status_code after ${waited}s)"
      break
    fi
  fi
  sleep 2
  waited=$(( waited + 2 ))
done

if [[ "$waited" -ge "$max_wait" ]]; then
  log "Warning: Paperless-NGX took longer than ${max_wait}s to respond, but proceeding with KVS registration."
fi

# 7. If initial data.json was found, import it into SQLite and rebuild search index
if [[ "$PENDING_LOADDATA" == "true" ]]; then
  log "Initial import: loading data.json into SQLite via loaddata..."
  docker compose -f "$COMPOSE_FILE" exec -T webserver python3 manage.py loaddata /tmp/data.json || log "Warning: loaddata non-zero exit."
  log "Rebuilding search index for imported documents..."
  docker compose -f "$COMPOSE_FILE" exec -T webserver python3 manage.py document_redo_search_index || log "Warning: document_redo_search_index non-zero exit."
  rm -f /tmp/data.json
  log "Initial database import complete! Creating first SQLite backup in S3..."
  /opt/paperless/runtime/backup-data.sh || log "Warning: Initial backup non-zero exit."
fi

# 8. Retrieve IMDSv2 token and instance public DNS hostname
imds_token=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || echo "")
public_hostname=""
if [[ -n "$imds_token" ]]; then
  public_hostname=$(curl -s -H "X-aws-ec2-metadata-token: $imds_token" "http://169.254.169.254/latest/meta-data/public-hostname" 2>/dev/null || echo "")
fi

if [[ -z "$public_hostname" ]]; then
  # Fallback to public IPv4 if hostname is empty
  public_hostname=$(curl -s -H "X-aws-ec2-metadata-token: $imds_token" "http://169.254.169.254/latest/meta-data/public-ipv4" 2>/dev/null || echo "")
fi

log "Detected instance public address: $public_hostname"

# 9. Update CloudFront KeyValueStore with status='running' and originDomain
if [[ -n "$KVS_NAME" ]] && [[ -n "$public_hostname" ]]; then
  log "Updating CloudFront KeyValueStore ($KVS_NAME)..."
  etag=$(aws cloudfront-keyvaluestore describe-key-value-store --kvs-arn "$KVS_NAME" --region "$AWS_REGION" --query "ETag" --output text 2>/dev/null || echo "")
  if [[ -n "$etag" ]]; then
    # Update originDomain
    aws cloudfront-keyvaluestore put-key \
      --kvs-arn "$KVS_NAME" \
      --key "originDomain" \
      --value "$public_hostname" \
      --if-match "$etag" \
      --region "$AWS_REGION" >/dev/null 2>&1 || log "Warning: Failed to put originDomain key."

    # Fetch updated etag for next put
    etag=$(aws cloudfront-keyvaluestore describe-key-value-store --kvs-arn "$KVS_NAME" --region "$AWS_REGION" --query "ETag" --output text 2>/dev/null || echo "")
    if [[ -n "$etag" ]]; then
      aws cloudfront-keyvaluestore put-key \
        --kvs-arn "$KVS_NAME" \
        --key "status" \
        --value "running" \
        --if-match "$etag" \
        --region "$AWS_REGION" >/dev/null 2>&1 || log "Warning: Failed to put status key."
    fi
    log "CloudFront KeyValueStore successfully updated with status=running and originDomain=$public_hostname."
  fi
fi

# Touch access log to mark boot time as last activity
touch /tmp/access.log

log "Paperless-NGX boot-sync finished successfully."
