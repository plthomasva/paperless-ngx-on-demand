#!/usr/bin/env bash
# watchdog.sh
# Multi-layer Task-Drain and Session-End Watchdog Service for Paperless-NGX.
# Ensures the EC2 instance only shuts down when:
# 1. No maintenance/upgrade lock exists
# 2. UI has been idle for >= IDLE_TIMEOUT_SECONDS
# 3. No pending inbox uploads exist in S3
# 4. /consume folder is completely empty
# 5. Redis celery task queue is empty (LLEN celery == 0)
# 6. /api/tasks/ reports zero active or pending tasks
# 7. No OCR / Tesseract / Ghostscript processes are running
# 8. All above conditions hold for CONSECUTIVE_IDLE_REQUIRED consecutive checks (2 minutes)

set -euo pipefail

if [[ -f "/opt/paperless/runtime/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source /opt/paperless/runtime/.env
  set +a
fi

IDLE_TIMEOUT_SECONDS="${IDLE_TIMEOUT_SECONDS:-900}" # 15 minutes default
CHECK_INTERVAL_SECONDS="${CHECK_INTERVAL_SECONDS:-60}"
CONSECUTIVE_IDLE_REQUIRED="${CONSECUTIVE_IDLE_REQUIRED:-2}"
INBOX_BUCKET="${INBOX_BUCKET:-}"
KVS_NAME="${KVS_NAME:-}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ACCESS_LOG="/tmp/access.log"
MAINTENANCE_LOCK="/tmp/paperless_maintenance.lock"
COMPOSE_FILE="/opt/paperless/runtime/docker-compose.yml"

idle_passes=0

# Ensure access log exists initially without modifying timestamp if already present
[[ -f "$ACCESS_LOG" ]] || touch "$ACCESS_LOG"

log() {
  echo "[watchdog $(date -u +'%Y-%m-%d %H:%M:%SZ')] $*"
}

update_kvs_status() {
  local new_status="$1"
  if [[ -n "$KVS_NAME" ]]; then
    log "Updating CloudFront KeyValueStore ($KVS_NAME) status to '$new_status'..."
    local etag
    etag=$(aws cloudfront-keyvaluestore describe-key-value-store --kvs-arn "$KVS_NAME" --region "$AWS_REGION" --query "ETag" --output text 2>/dev/null || echo "")
    if [[ -n "$etag" ]]; then
      aws cloudfront-keyvaluestore put-key \
        --kvs-arn "$KVS_NAME" \
        --key "status" \
        --value "$new_status" \
        --if-match "$etag" \
        --region "$AWS_REGION" >/dev/null 2>&1 || log "Warning: Failed to update KVS status."
    fi
  fi
}

pull_s3_inbox() {
  if [[ -n "$INBOX_BUCKET" ]]; then
    # Check if there are any non-zero byte files under s3://${INBOX_BUCKET}/consume/
    # (ignores 0-byte directory markers created by S3 console or tools)
    local s3_count
    s3_count=$(aws s3 ls "s3://${INBOX_BUCKET}/consume/" --region "$AWS_REGION" 2>/dev/null | awk '$3 > 0 {print $4}' | wc -l || echo 0)
    s3_count=$(echo "$s3_count" | tr -dc '0-9')
    s3_count=${s3_count:-0}
    if [[ "$s3_count" -gt 0 ]]; then
      log "Found $s3_count file(s) in S3 Inbox. Moving to /mnt/consume/..."
      aws s3 mv "s3://${INBOX_BUCKET}/consume/" "/mnt/consume/" --recursive --exclude "" --exclude "*/" --region "$AWS_REGION" 2>/dev/null || true
      # Reset idle activity since new files just arrived
      touch "$ACCESS_LOG"
      return 0
    fi
  fi
  return 1
}

is_system_busy() {
  # 1. Maintenance / upgrade lock
  if [[ -f "$MAINTENANCE_LOCK" ]]; then
    log "Busy: Maintenance lock active ($MAINTENANCE_LOCK)."
    return 0
  fi

  # 2. Check S3 inbox for pending files
  if pull_s3_inbox; then
    log "Busy: Documents pulled from S3 Inbox."
    return 0
  fi

  # 3. Check local /mnt/consume folder
  if [[ -d "/mnt/consume" ]] && [[ -n "$(ls -A /mnt/consume 2>/dev/null)" ]]; then
    log "Busy: Files present in /mnt/consume directory."
    return 0
  fi

  # 4. Check Redis celery queue depth
  local redis_queue_len
  redis_queue_len=$(docker compose -f "$COMPOSE_FILE" exec -T broker redis-cli LLEN celery 2>/dev/null || echo "0")
  # Strip any carriage returns or whitespace
  redis_queue_len=$(echo "$redis_queue_len" | tr -dc '0-9')
  redis_queue_len=${redis_queue_len:-0}
  if [[ "$redis_queue_len" -gt 0 ]]; then
    log "Busy: $redis_queue_len tasks waiting in Redis Celery queue."
    return 0
  fi

  # 5. Check Paperless API tasks
  local active_tasks
  active_tasks=$(curl -sf -m 5 "http://127.0.0.1:8080/api/tasks/" 2>/dev/null \
    | grep -oE '"status":\s*"(PENDING|STARTED|RETRY)"' | wc -l || echo 0)
  active_tasks=$(echo "$active_tasks" | tr -dc '0-9')
  active_tasks=${active_tasks:-0}
  if [[ "$active_tasks" -gt 0 ]]; then
    log "Busy: $active_tasks active or pending task(s) in Paperless API."
    return 0
  fi

  # 6. Check running OCR / Celery worker subprocesses
  if pgrep -f "(tesseract|ocrmypdf|gs|celery.*worker)" >/dev/null 2>&1 && ps -eo stat,comm | grep -E "^[RD].*(tesseract|ocrmypdf|gs)" >/dev/null 2>&1; then
    log "Busy: OCR or document converter subprocess actively computing."
    return 0
  fi

  return 1 # Not busy
}

log "Paperless watchdog initialized. IDLE_TIMEOUT_SECONDS=$IDLE_TIMEOUT_SECONDS, CHECK_INTERVAL_SECONDS=$CHECK_INTERVAL_SECONDS"

while true; do
  sleep "$CHECK_INTERVAL_SECONDS"

  now=$(date +%s)
  last_activity=$(stat -c %Y "$ACCESS_LOG" 2>/dev/null || echo "$now")
  ui_idle_seconds=$(( now - last_activity ))

  if [[ "$ui_idle_seconds" -lt "$IDLE_TIMEOUT_SECONDS" ]]; then
    [[ "$idle_passes" -gt 0 ]] && log "UI active ($ui_idle_seconds < $IDLE_TIMEOUT_SECONDS s). Resetting idle counter."
    idle_passes=0
    continue
  fi

  if is_system_busy; then
    idle_passes=0
    continue
  fi

  idle_passes=$(( idle_passes + 1 ))
  log "Idle check passed ($idle_passes/$CONSECUTIVE_IDLE_REQUIRED). UI idle for ${ui_idle_seconds}s, 0 background tasks."

  if [[ "$idle_passes" -ge "$CONSECUTIVE_IDLE_REQUIRED" ]]; then
    log "Idle threshold and task draining complete. Initiating graceful scale-to-zero..."

    # Step 1: Update KVS status so CloudFront immediately diverts new requests to wake-up Lambda
    update_kvs_status "stopped"

    # Step 2: Grace period for any last in-flight HTTP responses
    sleep 3

    # Step 3: Run session-end backup of SQLite and metadata manifest
    log "Triggering session-end data backup to S3..."
    /opt/paperless/runtime/backup-data.sh || log "Warning: backup-data.sh returned non-zero."

    # Step 4: Stop Docker Compose services gracefully
    log "Stopping Paperless-NGX and Redis containers..."
    docker compose -f "$COMPOSE_FILE" stop -t 60 || true

    # Step 5: Flush and unmount media storage cleanly
    log "Unmounting media storage mount..."
    fusermount -u -z /mnt/paperless-media 2>/dev/null || umount -l /mnt/paperless-media 2>/dev/null || true

    # Step 6: Shutdown the instance ($0/hr compute)
    log "Shutting down system..."
    shutdown -h now
    break
  fi
done

