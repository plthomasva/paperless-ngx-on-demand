#!/usr/bin/env bash
# boot-sync.sh
# Runs at EC2 system boot. Mounts s3fs, restores /data from S3 if missing,
# starts Docker Compose, verifies Paperless is healthy, and updates CloudFront
# KeyValueStore to route traffic to this instance.

set -euo pipefail

if [[ -f "/opt/paperless/runtime/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source /opt/paperless/runtime/.env
  set +a
fi

MEDIA_BUCKET="${MEDIA_BUCKET:-}"
MEDIA_SUBPATH="${MEDIA_SUBPATH:-media}"
INBOX_BUCKET="${INBOX_BUCKET:-}"
KVS_NAME="${KVS_NAME:-}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ORIGIN_VERIFY_SECRET="${ORIGIN_VERIFY_SECRET:-}"
COMPOSE_FILE="/opt/paperless/runtime/docker-compose.yml"

log() {
  echo "[boot-sync $(date -u +'%Y-%m-%d %H:%M:%SZ')] $*"
}

log "Starting Paperless-NGX boot initialization..."

# Sync latest runtime scripts and configuration from S3 if available
if [[ -n "$MEDIA_BUCKET" ]]; then
  if [[ "${BOOT_SYNC_REEXEC:-0}" != "1" ]]; then
    log "Syncing latest runtime scripts from s3://${MEDIA_BUCKET}/runtime/..."
    aws s3 sync "s3://${MEDIA_BUCKET}/runtime/" "/opt/paperless/runtime/" --region "$AWS_REGION" 2>/dev/null || true
    chmod +x /opt/paperless/runtime/*.sh 2>/dev/null || true
    export BOOT_SYNC_REEXEC=1
    exec /opt/paperless/runtime/boot-sync.sh "$@"
  fi
fi

# 1. Create required directories
mkdir -p /mnt/data /mnt/paperless-media /mnt/consume /mnt/export /tmp/paperless /var/cache/s3fs
chmod 775 /tmp/paperless
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

# 3. Mount S3 Media Bucket via mount-s3 if not already mounted
if [[ -n "$MEDIA_BUCKET" ]]; then
  if mountpoint -q /mnt/paperless-media; then
    log "/mnt/paperless-media is already mounted."
  else
    log "Preparing clean mountpoint for /mnt/paperless-media..."
    fusermount -u -z /mnt/paperless-media 2>/dev/null || umount -l /mnt/paperless-media 2>/dev/null || true
    rm -rf /mnt/paperless-media
    mkdir -p /mnt/paperless-media
    chown 1000:1000 /mnt/paperless-media
    chmod 755 /mnt/paperless-media

    prefix_opt=""
    if [[ -n "$MEDIA_SUBPATH" ]]; then
      prefix_opt="--prefix ${MEDIA_SUBPATH%/}/"
    fi
    log "Mounting S3 bucket '$MEDIA_BUCKET' at /mnt/paperless-media via mount-s3 ($prefix_opt)..."
    mount-s3 "$MEDIA_BUCKET" /mnt/paperless-media $prefix_opt --allow-other --uid 1000 --gid 1000 --allow-overwrite --allow-delete --auto-unmount
    sleep 1
    if mountpoint -q /mnt/paperless-media; then
      log "mount-s3 mount successful and verified on /mnt/paperless-media."
    else
      log "Error: Failed to mount /mnt/paperless-media via mount-s3."
      exit 1
    fi
  fi
fi

# 4. Pull any incoming documents from S3 Inbox (excluding 0-byte directory markers)
if [[ -n "$INBOX_BUCKET" ]]; then
  log "Checking for pending documents in s3://${INBOX_BUCKET}/consume/..."
  aws s3 mv "s3://${INBOX_BUCKET}/consume/" "/mnt/consume/" --recursive --exclude "" --exclude "*/" --region "$AWS_REGION" 2>/dev/null || true
fi

# 5. Ensure CSRF trusted origins and domain are configured for custom domains
DOMAIN_NAME="${DOMAIN_NAME:-pod.painless-computing.com}"
default_trusted="https://${DOMAIN_NAME},https://*.painless-computing.com,https://*.cloudfront.net,https://localhost,http://localhost"
if [[ -n "${PAPERLESS_CSRF_TRUSTED_ORIGINS:-}" ]]; then
  if [[ "$PAPERLESS_CSRF_TRUSTED_ORIGINS" != *"$DOMAIN_NAME"* ]]; then
    export PAPERLESS_CSRF_TRUSTED_ORIGINS="${PAPERLESS_CSRF_TRUSTED_ORIGINS},${default_trusted}"
  fi
else
  export PAPERLESS_CSRF_TRUSTED_ORIGINS="$default_trusted"
fi

if [[ -z "${PAPERLESS_URL:-}" ]] || [[ "$PAPERLESS_URL" == *"localhost"* ]]; then
  export PAPERLESS_URL="https://${DOMAIN_NAME}"
fi

# Ensure updated environment variables are persisted in /opt/paperless/runtime/.env
if [[ -f "/opt/paperless/runtime/.env" ]] && ! grep -q "pod.painless-computing.com" /opt/paperless/runtime/.env 2>/dev/null; then
  cat << ENV_APPEND >> /opt/paperless/runtime/.env
DOMAIN_NAME=${DOMAIN_NAME}
PAPERLESS_URL=${PAPERLESS_URL}
PAPERLESS_CSRF_TRUSTED_ORIGINS=${PAPERLESS_CSRF_TRUSTED_ORIGINS}
ENV_APPEND
fi

# 6. Start Docker Compose services (nginx activity proxy uses envsubst for ORIGIN_VERIFY_SECRET)
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
    if [[ "$status_code" =~ ^(200|301|302|401|403)$ ]]; then
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
  cp -f /tmp/data.json /mnt/export/data.json
  docker compose -f "$COMPOSE_FILE" exec -T webserver python3 manage.py loaddata --ignorenonexistent /usr/src/paperless/export/data.json || log "Warning: loaddata non-zero exit."
  log "Rebuilding search index for imported documents..."
  docker compose -f "$COMPOSE_FILE" exec -T webserver python3 manage.py document_index reindex || log "Warning: document_index reindex non-zero exit."
  rm -f /tmp/data.json /mnt/export/data.json
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
