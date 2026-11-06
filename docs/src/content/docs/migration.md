---
title: Migration Guide (Raspberry Pi & Local Docker)
description: How to safely migrate an existing Paperless-NGX installation to AWS On-Demand.
---

If you already run Paperless-NGX on a home server (such as a Raspberry Pi 4 or a local Docker Compose setup), migrating your documents, tags, custom fields, correspondent rules, and users to AWS is straightforward.

---

## Migration Options

Paperless-NGX provides two supported migration paths:
1. **Paperless Document Exporter / Importer (Recommended)**: Portable, architecture-independent format that transfers all files, tags, and metadata cleanly.
2. **Raw Database & Media Sync (`scripts/migrate-from-pi.sh`)**: Direct transfer for SQLite installations.

---

## Method 1: Using the Official Document Exporter (Recommended)

### Step 1: Export from your local machine
On your Raspberry Pi or existing Docker server, run the export command:

```bash
# If running via Docker Compose
docker compose exec webserver document_exporter ../export
```

This generates an `export/` directory containing JSON metadata files, original documents, and thumbnails.

### Step 2: Upload the export archive to S3
Using the AWS CLI on your local machine:

```bash
aws s3 sync ./export "s3://${S3_BUCKET}/migration-export/" --profile paperless
```

### Step 3: Import into Paperless-NGX On-Demand
Connect to your on-demand EC2 instance via AWS SSM Session Manager:

```bash
aws ssm start-session --target <instance-id> --profile paperless
```

Run the document importer:
```bash
sudo -u paperless docker compose -f /opt/paperless/docker-compose.yml exec webserver \
  document_importer /media/migration-export
```

---

## Method 2: Direct SQLite & S3 Media Sync

If your existing installation already uses SQLite:

1. Stop your local Paperless instance to prevent writes:
   ```bash
   docker compose down
   ```
2. Upload your existing `media/` directory directly to your S3 bucket:
   ```bash
   aws s3 sync /path/to/local/media/ "s3://${S3_BUCKET}/media/" --profile paperless
   ```
3. Backup and upload your `db.sqlite3`:
   ```bash
   sqlite3 db.sqlite3 ".backup /tmp/db-migration.sqlite3"
   aws s3 cp /tmp/db-migration.sqlite3 "s3://${S3_BUCKET}/backups/db-latest.sqlite3" --profile paperless
   ```
4. Start your On-Demand instance. On boot, `boot-sync.sh` will automatically pull `db-latest.sqlite3`, rebuild the Whoosh search index, and mount your media files.

