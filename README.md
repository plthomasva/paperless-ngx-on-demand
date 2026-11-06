# Paperless-NGX On-Demand (Scale-to-Zero on AWS)

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC_BY--NC_4.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc/4.0/)
[![Node.js CI](https://github.com/plthomasva/paperless-ngx-on-demand/actions/workflows/node.js.yml/badge.svg)](https://github.com/plthomasva/paperless-ngx-on-demand/actions/workflows/node.js.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=plthomasva_paperless-ngx-on-demand&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=plthomasva_paperless-ngx-on-demand)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=plthomasva_paperless-ngx-on-demand&metric=coverage)](https://sonarcloud.io/summary/new_code?id=plthomasva_paperless-ngx-on-demand)
[![Mutation Status](https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Fplthomasva%2Fpaperless-ngx-on-demand%2Fmain)](https://dashboard.stryker-mutator.io/reports/github.com/plthomasva/paperless-ngx-on-demand/main)

An Infrastructure-as-Code (AWS CDK in TypeScript) deployment of [Paperless-NGX](https://docs.paperless-ngx.com/) designed for **single-tenant home / personal use** with **zero idle compute cost** (~$1.50–$2.40/month total storage cost vs. $80+/month for standard cloud setups).

The server sleeps when idle ($0/hr compute) and **wakes up automatically on demand** when you visit the web UI or drop documents into an S3 inbox bucket. When your session ends and all background indexing/OCR tasks have completed, it automatically backs up the database to S3 and returns to sleep.

---

## Architecture

```
                       ┌──────────────────────────────────────────────────┐
                       │              Amazon CloudFront (TLS)             │
                       └────────────┬────────────────────────┬────────────┘
             1. Normal Traffic      │                        │ 2. When Stopped
             (When Running)         ▼                        ▼ (Status != 'running' / Poll)
            ┌────────────────────────────────────────────┐ ┌──────────────────────────────────┐
            │   EC2 t4g.medium (Graviton ARM64)          │ │   Wake-Up Lambda (Function URL)  │
            │  ┌──────────────────────────────────────┐  │ │  • Starts EC2 Instance           │
            │  │ Caddy / Nginx Activity Proxy (:8000) │  │ │  • Returns auto-refreshing       │
            │  │  • Tracks last HTTP request time     │  │ │    "Waking up..." HTML page      │
            │  └──────────────────┬───────────────────┘  │ └──────────────────────────────────┘
            │                     ▼                      │                   ▲
            │  ┌──────────────────────────────────────┐  │                   │ 3. Headless Trigger
            │  │ Paperless-NGX (:8080) + Redis Alpine │  │        ┌──────────┴───────────┐
            │  │  • Granian UI + Celery Workers       │  │        │ S3 Inbox Bucket      │
            │  │  • Local SQLite + Whoosh Index       │  │        │ (Drop PDFs any time) │
            │  └──────────────────┬───────────────────┘  │        └──────────────────────┘
            └─────────────────────┼──────────────────────┘
                                  ▼
        ┌────────────────────────────────────────────────────────┐
        │ Root EBS gp3 (10 GB)  • Local /data (SQLite + Whoosh)  │
        │                       • /tmp/paperless (OCR scratch)   │
        ├────────────────────────────────────────────────────────┤
        │ S3 Storage Bucket     • Mounted via s3fs at /media     │
        │ (Existing or auto-    • Free S3 Gateway VPC Endpoint   │
        │ namespaced)           • Local metadata & stat cache    │
        └────────────────────────────────────────────────────────┘
```

---

## Key Features

1. **Conflict-Free Automatic S3 Buckets:** When starting fresh, the stack auto-names your storage bucket `paperless-storage-<account>-<region>`—guaranteeing a globally unique, conflict-free bucket name without manual disambiguation. Alternatively, you can attach an existing S3 storage bucket.
2. **Interactive Setup Wizard (`npm run setup`):** Prompts for AWS profile, region, domain, and bucket preferences, saving everything into a local, `.gitignored` `paperless.config.json` file. No personal AWS account IDs, bucket names, or domains are ever committed to GitHub.
3. **Sub-Millisecond Dynamic Edge Routing:** Uses a `cloudfront-js-2.0` CloudFront Function reading from CloudFront KeyValueStore (`cf.updateRequestOrigin()`). When the instance starts and receives an ephemeral public address, traffic immediately cuts over without waiting 3–5 minutes for DNS or distribution updates.
4. **Multi-Layer Task-Drain Watchdog (`runtime/watchdog.sh`):**
   - Checks UI idle time (via Nginx request timestamps).
   - Checks S3 inbox for pending uploads.
   - Checks local `/consume` directory.
   - Checks Redis Celery queue depth (`LLEN celery == 0`).
   - Queries Paperless-NGX REST API (`/api/tasks/`) for `PENDING` / `STARTED` tasks.
   - Verifies no active OCR/Tesseract/Ghostscript subprocesses are running.
   - Requires **2 consecutive clean passes** (60s apart) before initiating shutdown.
5. **Session-End Transactional Backup (`runtime/backup-data.sh`):** Before the watchdog shuts down the instance, it runs an online `sqlite3 .backup`, exports a portable metadata manifest (`manifest.json`), and uploads a compressed snapshot to S3.
6. **Zero Open SSH Ports (AWS Systems Manager):** Management and upgrades are executed via AWS Systems Manager (SSM) Session Manager and Run Command.

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/plthomasva/paperless-ngx-on-demand.git
cd paperless-ngx-on-demand
npm install
```

### 2. Configure (Interactive CLI Wizard)

Run the setup wizard to configure your AWS profile, region, storage bucket, and optional custom domain:

```bash
npm run setup
```

This saves your settings locally to `paperless.config.json` (which is `.gitignored` to prevent leaking private account info).

### 3. Bootstrap CDK (One-time per AWS account/region)

```bash
npm run bootstrap
```

### 4. Deploy

```bash
npm run deploy
```

Outputs will display:

- `PaperlessUrl`: Your public HTTPS Paperless-NGX URL (Custom domain or CloudFront URL).
- `CloudFrontUrl`: The distribution's underlying domain.
- `S3StorageBucket`: The unified bucket used for media, inbox ingestion, and backups.
- `InstanceId`: EC2 Instance ID.

---

## Migrating from Raspberry Pi or Existing Server

### Step A: Export Database Metadata on Pi (Postgres or SQLite)

If migrating from PostgreSQL, export your database records into a portable fixture (takes ~2 seconds and requires 0 extra disk space for PDFs):

```bash
docker compose exec webserver python3 manage.py dumpdata \
    --exclude=contenttypes \
    --exclude=auth.Permission \
    --indent 2 > data.json
```

### Step B: Upload to S3

Upload the export file to your S3 bucket:

```bash
aws s3 cp data.json s3://<your-s3-bucket>/export/data.json --region us-east-1
```

### Step C: Stop Pi & Boot AWS

```bash
docker compose down
```

When your AWS instance boots up for the first time, `boot-sync.sh` automatically detects `data.json`, loads it into the new SQLite database, mounts your S3 media library, and rebuilds the search index.

---

## Document Ingestion While Sleeping

You can upload documents at any time—even when the server is powered off:

- **Web UI:** Visiting your URL will wake the instance, display the splash screen, and reload the document upload page once warm (~15–20s).
- **Headless S3 Drop Folder:** Upload PDFs or images to:
  ```bash
  aws s3 cp document.pdf s3://<your-s3-bucket>/consume/
  ```
  The `s3:ObjectCreated` event triggers the Wake-Up Lambda to power on the server. The watchdog pulls the file, indexes it, and shuts the server back down automatically.

---

## Application & Database Upgrades

Upgrades are executed remotely via **AWS Systems Manager (SSM)** with zero open SSH ports:

```bash
./scripts/trigger-upgrade.sh <ec2-instance-id> us-east-1
```

The script:

1. Wakes up the instance if stopped.
2. Acquires a maintenance lock so the watchdog cannot shut down mid-upgrade.
3. Takes a pre-upgrade database backup in S3 and records the current Docker image digest.
4. Pulls latest container images and runs `manage.py migrate`.
5. Verifies API health checks; if the new version fails, automatically reverts the container image and restores the pre-upgrade database snapshot.

---

## Testing

Run unit tests and CDK architectural guardrail assertions:

```bash
npm test
```

The test suite validates:

- Zero NAT Gateways, zero ALBs, zero RDS instances, and zero ElastiCache instances.
- Conflict-free account and region namespaced S3 bucket generation.
- CloudFront Function 2.0 and KeyValueStore wiring.
- Wake-Up Lambda state transitions, S3 event triggers, and EventBridge shutdowns.
- Watchdog 6-layer busy checks and consecutive idle logic.

---

## License & Attribution

- **Paperless-NGX On-Demand Orchestration**: Copyright © 2026 Peter L. Thomas. Licensed under the [Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](LICENSE) license.
- **Third-Party Assets (Paperless-NGX Favicon)**: The official Paperless-NGX favicon (`favicon.ico` / `lib/lambda/favicon-data.ts`) is copyright © Paperless-NGX Contributors and distributed under the [GNU General Public License v3.0 (GPL-3.0)](https://www.gnu.org/licenses/gpl-3.0.txt). See [NOTICE](NOTICE) for complete third-party component attribution.
