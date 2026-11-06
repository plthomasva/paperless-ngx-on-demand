# Paperless-NGX On-Demand (Scale-to-Zero on AWS)

An Infrastructure-as-Code (AWS CDK in TypeScript) deployment of [Paperless-NGX](https://docs.paperless-ngx.com/) designed for **single-tenant home / personal use** with **zero idle compute cost** (~$1.50–$2.40/month total storage cost vs. $80+/month for standard cloud setups).

The server sleeps when idle and **wakes up automatically on demand** when you visit the web UI or drop documents into an S3 inbox bucket. When your session ends and all background indexing/OCR tasks have completed, it automatically backs up the database to S3 and returns to sleep.

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
        │ Existing S3 Media     • Mounted via s3fs at /media     │
        │ Bucket (originals/    • Free S3 Gateway VPC Endpoint   │
        │ archive/thumbnails)   • Local metadata & stat cache    │
        └────────────────────────────────────────────────────────┘
```

### Why This Design Beats Standard Cloud Architectures
| Component | Typical AWS Setup Cost | This On-Demand Setup Cost | Why? |
| :--- | :--- | :--- | :--- |
| **Compute** | Fargate or EC2 24/7: **$25–$35/mo** | EC2 `t4g.medium`: **$0.34/mo** | Scaled to zero ($0/hr) when sleeping. Runs only ~10 hrs/mo. |
| **Load Balancer** | ALB: **$16.20/mo** | CloudFront + KVS: **$0.00/mo** | Free tier CloudFront Function routes directly to instance. |
| **NAT Gateway** | NAT Gateway: **$32.85/mo** | Single Public Subnet: **$0.00/mo** | CloudFront Prefix-List restricted SG + free S3 Gateway Endpoint. |
| **Database** | RDS Postgres: **$15.00/mo** | Local SQLite on EBS: **$0.00/mo** | Single-tenant SQLite runs at local NVMe speed; backups stream to S3. |
| **Cache/Queue** | ElastiCache Redis: **$12.00/mo** | Redis 7 Alpine Sidecar: **$0.00/mo** | Redis runs in-container; task-drain watchdog drains it before stop. |
| **Media Storage** | EBS or EFS: **$2.00–$8.00/mo** | Existing S3 Bucket: **$0.50/mo** | Mounted via `s3fs` with local stat cache and S3 Gateway Endpoint. |
| **Total** | **~$90–$110 / month** | **~$1.50 – $2.40 / month** | |

---

## Key Features

1. **Sub-Millisecond Dynamic Edge Routing:** Uses a `cloudfront-js-2.0` CloudFront Function reading from CloudFront KeyValueStore (`cf.updateRequestOrigin()`). When the instance starts and receives an ephemeral public address, traffic immediately cuts over without waiting 3–5 minutes for DNS or distribution updates.
2. **Multi-Layer Task-Drain Watchdog (`runtime/watchdog.sh`):**
   * Checks UI idle time (via Nginx request timestamps).
   * Checks S3 inbox for pending uploads.
   * Checks local `/consume` directory.
   * Checks Redis Celery queue depth (`LLEN celery == 0`).
   * Queries Paperless-NGX REST API (`/api/tasks/`) for `PENDING` / `STARTED` tasks.
   * Verifies no active OCR/Tesseract/Ghostscript subprocesses are running.
   * Requires **2 consecutive clean passes** (60s apart) before initiating shutdown.
3. **Session-End Transactional Backup (`runtime/backup-data.sh`):** Before the watchdog shuts down the instance, it runs an online `sqlite3 .backup`, exports a portable metadata manifest (`manifest.json`), and uploads a compressed snapshot to `s3://<inbox-bucket>/backups/`.
4. **Self-Healing Boot Restore (`runtime/boot-sync.sh`):** If the EC2 instance or root EBS disk is ever replaced, it automatically detects an empty `/mnt/data` directory and restores the latest snapshot from S3.
5. **Zero Open SSH Ports (AWS Systems Manager):** Management and upgrades are executed via AWS Systems Manager (SSM) Session Manager and Run Command.

---

## Quick Start

### 1. Prerequisites
* [Node.js 22+](https://nodejs.org/) and npm
* [AWS CLI](https://aws.amazon.com/cli/) configured with deployment permissions
* AWS CDK v2 (`npm install -g aws-cdk` or use local `npx cdk`)

### 2. Deploy the CDK Stack
Clone and install dependencies:
```bash
git clone <repo-url> paperless-ngx-on-demand
cd paperless-ngx-on-demand
npm install
```

Synthesize and deploy:
```bash
# Deploy with your existing S3 media bucket (where your originals/ and archive/ live)
npx cdk deploy --context existingMediaBucketName=my-existing-paperless-s3-bucket \
               --context adminUser=admin \
               --context adminEmail=admin@example.com
```

Outputs will display:
* `CloudFrontUrl`: Your public HTTPS Paperless-NGX URL.
* `S3InboxBucket`: Bucket for drop uploads and backups.
* `InstanceId`: EC2 Instance ID.

---

## Migrating from Raspberry Pi

Because your media files (`originals/`, `archive/`, `thumbnails/`) are already mounted to S3 via `s3fs`, **you do not need to re-upload gigabytes of documents!**

Only your SQLite database and search index (`/data`) need to be synced:

1. On your Raspberry Pi, run the migration helper:
   ```bash
   ./scripts/migrate-from-pi.sh /home/pi/paperless-ngx <your-s3-inbox-bucket-name> us-east-1
   ```
2. The script takes an online snapshot of `db.sqlite3`, bundles the Whoosh index and classifier model, and uploads `paperless-data-latest.tar.gz` to S3.
3. Start or visit your AWS instance. On boot, `boot-sync.sh` automatically downloads the archive and mounts your existing S3 media bucket.

---

## Document Ingestion While Sleeping

You can upload documents at any time—even when the server is powered off:
* **Web UI:** Visiting `https://<cloudfront-domain>/` will wake the instance, display the splash screen, and reload the document upload page once warm (~15–20s).
* **Headless S3 Drop Folder:** Upload PDFs or images to:
  ```bash
  aws s3 cp document.pdf s3://<s3-inbox-bucket>/consume/
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
* Zero NAT Gateways, zero ALBs, zero RDS instances, and zero ElastiCache instances.
* CloudFront Function 2.0 and KeyValueStore wiring.
* Wake-Up Lambda state transitions, S3 event triggers, and EventBridge shutdowns.
* Watchdog 6-layer busy checks and consecutive idle logic.

---

## License
Apache-2.0
