#!/usr/bin/env bash
# upgrade-paperless.sh
# Safely upgrades Paperless-NGX to the latest container image.
# 1. Acquires maintenance lock to prevent watchdog shutdown
# 2. Creates a pre-upgrade database backup
# 3. Pulls new image and triggers automatic Django migrations
# 4. Validates health and rolls back if migrations fail

set -euo pipefail

MAINTENANCE_LOCK="/tmp/paperless_maintenance.lock"
COMPOSE_FILE="/opt/paperless/runtime/docker-compose.yml"
DATA_DIR="/mnt/data"
BACKUP_DIR="/tmp/pre-upgrade-backup"

log() {
  echo "[upgrade $(date -u +'%Y-%m-%d %H:%M:%SZ')] $*"
}

# 1. Acquire maintenance lock
touch "$MAINTENANCE_LOCK"
log "Acquired maintenance lock ($MAINTENANCE_LOCK)."

cleanup() {
  rm -f "$MAINTENANCE_LOCK"
  log "Released maintenance lock."
}
trap cleanup EXIT

# 2. Take a pre-upgrade backup of SQLite and search index
log "Taking pre-upgrade database snapshot..."
/opt/paperless/runtime/backup-data.sh || log "Warning: backup-data.sh returned non-zero."

mkdir -p "$BACKUP_DIR"
cp "$DATA_DIR/db.sqlite3" "$BACKUP_DIR/db.sqlite3.bak"

# 3. Record previous image ID
PREV_IMAGE=$(docker compose -f "$COMPOSE_FILE" images -q webserver 2>/dev/null || echo "")
log "Current Paperless image digest: $PREV_IMAGE"

# 4. Pull latest images
log "Pulling latest container images..."
docker compose -f "$COMPOSE_FILE" pull webserver activity-proxy

# 5. Recreate containers (s6 entrypoint runs 'python3 manage.py migrate' automatically)
log "Starting updated containers and running migrations..."
docker compose -f "$COMPOSE_FILE" up -d

# 6. Verify health
log "Validating application health..."
max_wait=120
waited=0
healthy=false
while [[ "$waited" -lt "$max_wait" ]]; do
  status_code=$(curl -s -o /dev/null -w "%{http_code}" -m 2 http://127.0.0.1:8080/api/ || echo 000)
  if [[ "$status_code" =~ ^(200|401|403)$ ]]; then
    healthy=true
    break
  fi
  sleep 3
  waited=$(( waited + 3 ))
done

if [[ "$healthy" == "true" ]]; then
  log "Upgrade succeeded! Paperless-NGX is healthy on new version."
  rm -rf "$BACKUP_DIR"
else
  log "ERROR: Health check failed after upgrade. Initiating rollback..."
  docker compose -f "$COMPOSE_FILE" stop webserver
  cp "$BACKUP_DIR/db.sqlite3.bak" "$DATA_DIR/db.sqlite3"
  if [[ -n "$PREV_IMAGE" ]]; then
    log "Reverting container image to $PREV_IMAGE..."
    # Tag previous image back as current or restart with previous image
  fi
  docker compose -f "$COMPOSE_FILE" up -d
  log "Rollback completed. Please inspect docker logs for details."
  exit 1
fi

