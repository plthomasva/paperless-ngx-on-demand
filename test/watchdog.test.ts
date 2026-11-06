import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Watchdog and Runtime Scripts Validation', () => {
  const runtimeDir = path.join(__dirname, '../runtime');

  it('contains valid watchdog.sh with all 6 multi-layer busy checks', () => {
    const watchdogPath = path.join(runtimeDir, 'watchdog.sh');
    expect(fs.existsSync(watchdogPath)).toBe(true);

    const content = fs.readFileSync(watchdogPath, 'utf8');

    // 1. Maintenance lock check
    expect(content).toContain('MAINTENANCE_LOCK');
    // 2. S3 inbox pull
    expect(content).toContain('pull_s3_inbox');
    // 3. /mnt/consume directory check
    expect(content).toContain('/mnt/consume');
    // 4. Redis Celery queue check (LLEN celery)
    expect(content).toContain('LLEN celery');
    // 5. /api/tasks/ check
    expect(content).toContain('/api/tasks/');
    // 6. Subprocess OCR check
    expect(content).toContain('tesseract|ocrmypdf|gs');

    // Consecutive idle verification
    expect(content).toContain('CONSECUTIVE_IDLE_REQUIRED');
    expect(content).toContain('update_kvs_status "stopped"');
    expect(content).toContain('backup-data.sh');
    expect(content).toContain('shutdown -h now');
  });

  it('contains backup-data.sh with transactional sqlite3 online backup and metadata export', () => {
    const backupPath = path.join(runtimeDir, 'backup-data.sh');
    expect(fs.existsSync(backupPath)).toBe(true);

    const content = fs.readFileSync(backupPath, 'utf8');
    expect(content).toContain('.backup');
    expect(content).toContain('dumpdata');
    expect(content).toContain('s3://${INBOX_BUCKET}/backups/');
  });

  it('contains upgrade-paperless.sh with maintenance lock, pre-upgrade snapshot, and rollback', () => {
    const upgradePath = path.join(runtimeDir, 'upgrade-paperless.sh');
    expect(fs.existsSync(upgradePath)).toBe(true);

    const content = fs.readFileSync(upgradePath, 'utf8');
    expect(content).toContain('MAINTENANCE_LOCK');
    expect(content).toContain('backup-data.sh');
    expect(content).toContain('docker compose');
    expect(content).toContain('rollback');
  });

  it('contains boot-sync.sh with s3fs mount, latest data restore, and KVS origin update', () => {
    const bootPath = path.join(runtimeDir, 'boot-sync.sh');
    expect(fs.existsSync(bootPath)).toBe(true);

    const content = fs.readFileSync(bootPath, 'utf8');
    expect(content).toContain('s3fs');
    expect(content).toContain('paperless-data-latest.tar.gz');
    expect(content).toContain('cloudfront-keyvaluestore');
    expect(content).toContain('originDomain');
  });
});
