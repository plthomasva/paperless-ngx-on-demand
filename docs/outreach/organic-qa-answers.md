# Organic Q&A Answers & GitHub Discussion #762 Draft

This document provides:
1. A ready-to-review reply and one-step `gh api graphql` command for the single open, relevant GitHub Discussion on `paperless-ngx/paperless-ngx` (**Discussion #762**).
2. Reusable, technically grounded answers for recurring community questions on `r/Paperlessngx`, `r/selfhosted`, and GitHub Discussions.
3. A complete audit table of all GitHub Discussions and Reddit threads inspected during the outreach survey, explaining why locked/archived threads are not targeted.

> **Important:** Per `paperless-ngx/paperless-ngx`'s `CONTRIBUTING.md` (`# Use of AI Tools`), all AI-assisted comments must include explicit AI disclosure and **must be personally reviewed and submitted by a human contributor**. Nothing has been auto-posted.

---

## Section 1: GitHub Discussion #762 ("S3 as document backend")

- **Thread URL:** <https://github.com/paperless-ngx/paperless-ngx/discussions/762>
- **Status:** Open / Unlocked (`closed: false`, `locked: false`, `isAnswered: false`, 17 comments, last updated `2026-08-18`)
- **GraphQL Node ID:** `D_kwDOG1Zs184APVAI`
- **AI Disclosure Requirement:** `paperless-ngx/paperless-ngx` `CONTRIBUTING.md` (`# Use of AI Tools`) requires:
  1. Clear disclosure when any comment is generated in whole or in part by an AI tool or agent.
  2. Personal human review, verification, and submission (no autonomous agent posting).

### Ready-to-Post Comment

> For anyone looking at S3-backed Paperless-ngx without paying for 24/7 RDS + EFS, there is an important distinction between **where `media/` lives** and **where `data/` (SQLite/Postgres + Whoosh) lives**.
>
> Two common failure modes that show up in past discussions here:
> - **Mounting `data/` over a network/object filesystem** causes Celery scheduler and database locking errors (as noted in [#10314](https://github.com/paperless-ngx/paperless-ngx/discussions/10314)).
> - **Using `rclone` FUSE mounts for `media/`** can hit `shutil.move()` / cross-device rename errors when changing `storage_path` (e.g., [#8781](https://github.com/paperless-ngx/paperless-ngx/discussions/8781)), depending on VFS cache settings.
>
> A pattern that works reliably in practice is to **split storage by I/O semantics**:
> 1. **Keep `data/` (SQLite + Whoosh index) and OCR scratch (`/tmp/paperless`) on local block storage** (e.g., a small EBS `gp3` volume) so SQLite, Celery/Redis, and Tesseract/OCRmyPDF get real POSIX semantics and low-latency random I/O.
> 2. **Mount only `media/` from S3 using AWS's official `mount-s3` (Mountpoint for Amazon S3)** with `--allow-other --uid 1000 --gid 1000 --allow-overwrite --allow-delete --auto-unmount`.
> 3. **Snapshot `data/` back to S3 on idle/shutdown** using `sqlite3 /mnt/data/db.sqlite3 ".backup ..."` (online, transactionally consistent) plus `manage.py dumpdata` for a portable `manifest.json`, then restore from S3 if the local volume is ever replaced.
> 4. **Optional scale-to-zero:** If you don't need 24/7 uptime, a task-draining watchdog can verify `consume/` is empty, Redis `LLEN celery` is `0`, `/api/tasks/` has no active jobs, and no `tesseract`/`ocrmypdf`/`gs` processes are running before backing up to S3 and shutting down the EC2 instance (waking it on-demand via a CloudFront + Lambda splash page).
>
> If a concrete reference implementation is helpful, I put together an AWS CDK v2 setup using this exact layout (`mount-s3` for `media/`, local EBS SQLite + `.backup` snapshots to S3, and scale-to-zero Graviton EC2) here: <https://github.com/plthomasva/paperless-ngx-on-demand>
>
> *(Disclosure: This comment was drafted with AI assistance and reviewed/verified by me before posting.)*

### One-Step `gh api graphql` Command (Run After Human Review)

First review the comment text above, then run the following command (uses your authenticated `gh` CLI):

```bash
BODY=$(cat <<'EOF'
For anyone looking at S3-backed Paperless-ngx without paying for 24/7 RDS + EFS, there is an important distinction between **where `media/` lives** and **where `data/` (SQLite/Postgres + Whoosh) lives**.

Two common failure modes that show up in past discussions here:
- **Mounting `data/` over a network/object filesystem** causes Celery scheduler and database locking errors (as noted in [#10314](https://github.com/paperless-ngx/paperless-ngx/discussions/10314)).
- **Using `rclone` FUSE mounts for `media/`** can hit `shutil.move()` / cross-device rename errors when changing `storage_path` (e.g., [#8781](https://github.com/paperless-ngx/paperless-ngx/discussions/8781)), depending on VFS cache settings.

A pattern that works reliably in practice is to **split storage by I/O semantics**:
1. **Keep `data/` (SQLite + Whoosh index) and OCR scratch (`/tmp/paperless`) on local block storage** (e.g., a small EBS `gp3` volume) so SQLite, Celery/Redis, and Tesseract/OCRmyPDF get real POSIX semantics and low-latency random I/O.
2. **Mount only `media/` from S3 using AWS's official `mount-s3` (Mountpoint for Amazon S3)** with `--allow-other --uid 1000 --gid 1000 --allow-overwrite --allow-delete --auto-unmount`.
3. **Snapshot `data/` back to S3 on idle/shutdown** using `sqlite3 /mnt/data/db.sqlite3 ".backup ..."` (online, transactionally consistent) plus `manage.py dumpdata` for a portable `manifest.json`, then restore from S3 if the local volume is ever replaced.
4. **Optional scale-to-zero:** If you don't need 24/7 uptime, a task-draining watchdog can verify `consume/` is empty, Redis `LLEN celery` is `0`, `/api/tasks/` has no active jobs, and no `tesseract`/`ocrmypdf`/`gs` processes are running before backing up to S3 and shutting down the EC2 instance (waking it on-demand via a CloudFront + Lambda splash page).

If a concrete reference implementation is helpful, I put together an AWS CDK v2 setup using this exact layout (`mount-s3` for `media/`, local EBS SQLite + `.backup` snapshots to S3, and scale-to-zero Graviton EC2) here: https://github.com/plthomasva/paperless-ngx-on-demand

*(Disclosure: This comment was drafted with AI assistance and reviewed/verified by me before posting.)*
EOF
)

gh api graphql \
  -f query='mutation($discussionId: ID!, $body: String!) { addDiscussionComment(input: {discussionId: $discussionId, body: $body}) { comment { url } } }' \
  -f discussionId='D_kwDOG1Zs184APVAI' \
  -f body="$BODY"
```

---

## Section 2: Reusable Technical Answers for Recurring Questions

Use these templates when fresh threads appear on `r/Paperlessngx`, `r/selfhosted`, or GitHub Discussions. Adapt the tone to match the thread, and include platform-appropriate AI disclosure if posting on a forum that requires it.

### Q1: "Can I run Paperless-NGX on AWS / S3 cheaply?"

**Short answer:** Yes—around **$2/month**—if you avoid 24/7 managed services (RDS, NAT Gateway, EFS) and instead use a **scale-to-zero Graviton EC2 instance + S3 + SQLite-on-EBS**.

#### Why a "standard" AWS setup is ~$78.63+/month

Most AWS Docker tutorials prescribe 24/7 managed components in `us-east-1`:

| Component | Traditional 24/7 Setup | Monthly Cost |
|---|---|---|
| **Compute** | 24/7 EC2 `t4g.medium` (730 hrs @ $0.0336/hr) | $24.53 |
| **Database** | Amazon RDS PostgreSQL `db.t4g.micro` | $18.25 |
| **Networking** | AWS NAT Gateway (730 hrs + data) | $32.85 |
| **Shared Storage** | Amazon EFS (10 GB general purpose) | $3.00 |
| **Total** | | **$78.63+ / mo** |

#### How to get it down to ~$2.04/month (97.4% savings)

For a personal document archive (~10 GB of PDFs/receipts, accessed ~1 hour/day = 30 active hours/month):

| Component | Scale-to-Zero Architecture | Monthly Cost |
|---|---|---|
| **Compute** | `t4g.medium` (2 vCPU, 4 GB RAM) — 30 active hrs/mo @ $0.0336/hr (`$0.00/hr` when stopped) | **$1.01** |
| **Local OS / DB Disk** | 10 GB EBS `gp3` @ $0.080/GB-mo (holds OS, `db.sqlite3`, Whoosh index, OCR scratch) | **$0.80** |
| **Document Storage** | 10 GB S3 Standard @ $0.023/GB-mo (holds `media/` via `mount-s3` + `backups/` snapshots) | **$0.23** |
| **Networking & Edge** | Public subnet (no NAT Gateway) + free S3 Gateway VPC Endpoint + CloudFront/KVS + Lambda + ACM TLS (Always-Free Tier) | **$0.00** |
| **Total (1 hr/day)** | | **$2.04 / mo** |

*(Usage scaling: ~$1.03/mo at 0 hrs/day storage-only, ~$1.53/mo at 30 min/day, ~$3.05/mo at 2 hrs/day.)*

#### Key architectural details that make it work
1. **No NAT Gateway:** Put the EC2 instance in a public subnet locked down by Security Group (inbound port `8000` allowed only from the CloudFront managed prefix list, zero SSH ports open—use SSM Session Manager) and attach a free **S3 Gateway VPC Endpoint** for `$0` S3 transfer.
2. **No RDS:** Run `PAPERLESS_DBENGINE=sqlite` on local EBS `gp3` for fast local I/O, and snapshot it to S3 on idle shutdown using `sqlite3 ... ".backup ..."` + `manage.py dumpdata`.
3. **S3 for `media/`:** Mount the S3 bucket at `/usr/src/paperless/media` using `mount-s3` (`--allow-other --allow-overwrite --allow-delete`).
4. **Scale-to-zero:** Stop the instance after an idle timeout (e.g., 15 minutes with no Nginx web traffic, empty `consume/` inbox, `LLEN celery == 0`, no active `/api/tasks/`, and no running `tesseract`/`ocrmypdf`/`gs` processes), and wake it automatically via a CloudFront Function + KeyValueStore + Lambda splash page.

If you want a concrete reference implementation, here is an open-source AWS CDK v2 project that implements this exact pattern: <https://github.com/plthomasva/paperless-ngx-on-demand>

---

### Q2: "Why doesn't Paperless-NGX work well on Fargate / Lambda / Cloud Run?"

**Short answer:** Paperless-NGX is a **stateful, multi-process, POSIX-filesystem-dependent** application with long-running CPU-heavy OCR jobs—the exact opposite of what stateless serverless platforms (Lambda, Cloud Run, scale-to-zero Fargate) are designed for.

#### The 4 specific friction points

1. **Stateful Database + Local Search Index (`data/`)**
   - Paperless-NGX expects either local SQLite (`db.sqlite3`) or a persistent PostgreSQL database, **plus** a local Whoosh full-text search index and classification model in `PAPERLESS_DATA_DIR`.
   - On Cloud Run or Lambda, local disk is ephemeral. To persist state across container restarts you have to pay 24/7 for managed Postgres (e.g., RDS `db.t4g.micro` at ~$18.25/mo) and/or EFS—which wipes out the cost savings of serverless.
   - Mounting `data/` over network/object storage causes database locking and Celery scheduler errors (see `paperless-ngx` Discussion [#10314](https://github.com/paperless-ngx/paperless-ngx/discussions/10314)).

2. **Redis Is Mandatory**
   - Paperless-NGX requires Redis (`PAPERLESS_REDIS`) not only as the Celery task broker, but also for application-level state/caching (see Discussion [#2647](https://github.com/paperless-ngx/paperless-ngx/discussions/2647), where SQS/NATS were rejected as drop-in replacements).
   - Serverless containers can't easily bundle an in-memory Redis that survives scale-to-zero without losing queued tasks, forcing you toward a 24/7 managed Redis (ElastiCache).

3. **Long-Running, CPU-Heavy OCR (`Tesseract` / `OCRmyPDF` / `Ghostscript`)**
   - Ingesting a large multi-page PDF can peg 2 vCPUs and run for minutes.
   - **AWS Lambda** has a hard 15-minute timeout, limited ephemeral `/tmp` scratch space, and no built-in multi-container orchestration for `webserver` + `celery` + `redis`.
   - **Cloud Run / Fargate** HTTP-request-based autoscaling can scale down or kill a container mid-OCR if there are no active HTTP requests while a background Celery worker is still processing `consume/`.

4. **POSIX Filesystem Expectations for `media/` and `consume/`**
   - Paperless-NGX moves, renames, and generates thumbnails/archive PDFs across `consume/` and `media/`. Stateless containers lack persistent local storage, and naive S3 FUSE mounts without proper flags or local scratch space can fail on rename/move operations (see Discussion [#8781](https://github.com/paperless-ngx/paperless-ngx/discussions/8781)).

#### When a Scale-to-Zero VM Pattern Works Instead

If your goal is **pay-per-use (~$2/mo)** rather than "pure serverless," a **scale-to-zero EC2 VM** solves all four problems cleanly:
- **Real Docker Compose + local EBS `gp3`:** `webserver`, `celery`, `redis`, `data/` (SQLite + Whoosh), and `/tmp/paperless` OCR scratch all run on fast local block storage with full POSIX semantics.
- **Task-draining watchdog before shutdown:** Instead of blindly killing containers on HTTP idle, a watchdog checks Nginx access logs, S3/local `consume/`, Redis `LLEN celery`, `/api/tasks/`, and active `tesseract`/`ocrmypdf`/`gs` processes before running `sqlite3 .backup` to S3 and shutting down (`shutdown -h now`).
- **On-demand wake-up:** CloudFront + KeyValueStore + a tiny Lambda splash page boots the VM when you visit the URL (~45–60s cold start) or when a file lands in the S3 `consume/` prefix.

Reference implementation (AWS CDK v2): <https://github.com/plthomasva/paperless-ngx-on-demand>

---

## Section 3: Thread Audit Table

All GitHub Discussions and Reddit threads discovered during Survey 3 were audited before drafting. Only **one** relevant thread (`paperless-ngx/paperless-ngx#762`) is open and unlocked.

### A. `paperless-ngx/paperless-ngx` GitHub Discussions

| # | Title | Status | Updated | Target? | Reason |
|---|---|---|---|---|---|
| [#14705](https://github.com/paperless-ngx/paperless-ngx/discussions/14705) | Paperless-NGX On-Demand: Zero-Idle Cloud Architecture with Task-Draining Watchdog (~$2/month on AWS) | Open / Unlocked | 2026-11-07 | **No (Author's own thread)** | Announcement thread already posted by `plthomasva` (`0` comments, `0` reactions). |
| [#762](https://github.com/paperless-ngx/paperless-ngx/discussions/762) | S3 as document backend | **Open / Unlocked** (`isAnswered: false`, 17 comments) | 2026-08-18 | **Yes (Section 1)** | Only open, unlocked, relevant discussion; directly asks about S3 storage backends. Requires `CONTRIBUTING.md` AI disclosure + human review. |
| [#4367](https://github.com/paperless-ngx/paperless-ngx/discussions/4367) | Serverless support? | Closed / Locked | 2024-01-18 | **No** | Auto-locked due to 180-day inactivity policy; read-only. |
| [#3797](https://github.com/paperless-ngx/paperless-ngx/discussions/3797) | Deploying to Cloud provider (GCP, AWS, etc) | Closed / Locked | 2023-11-17 | **No** | Auto-locked due to 180-day inactivity policy; read-only. |
| [#10314](https://github.com/paperless-ngx/paperless-ngx/discussions/10314) | [Support] (AWS ECS on EC2) | Closed / Locked | 2026-02-04 | **No** | Auto-closed/locked; read-only. Cited in Section 1 & Q2 for `stumpylog`'s guidance on not storing `data/` across the network. |
| [#8781](https://github.com/paperless-ngx/paperless-ngx/discussions/8781) | S3 mounted for storage - mv operation fails (change storage_path) | Closed / Locked | 2025-08-24 | **No** | Auto-closed/locked; read-only. Cited in Section 1 & Q2 for `rclone` + `shutil.move()` failure mode. |
| [#2647](https://github.com/paperless-ngx/paperless-ngx/discussions/2647) | Add NATS or SQS support for celery broker | Closed / Locked | 2024-03-21 | **No** | Auto-locked; read-only. Cited in Q2 for Redis being required beyond Celery. |

### B. Reddit Threads (`r/Paperlessngx` and `r/selfhosted`)

Reddit automatically archives threads after 6 months (`"Archived post. New comments cannot be posted and votes cannot be cast."`), and no Reddit credentials exist in this environment. All discovered threads are ≥6 months old, so none are targeted for necro-posting; instead, **Section 2** provides ready-to-use answers for future threads.

| Subreddit | Thread | Date | Age (as of Nov 2026) | Target? | Reason |
|---|---|---|---|---|---|
| `r/Paperlessngx` | [How to secure my instance?](https://www.reddit.com/r/Paperlessngx/comments/1tq0xva/how_to_secure_my_instance/) | 2026-05-28 | ~6 months | **No** | Borderline archival; already answered (Tailscale, Pangolin + mTLS, CloudFront + EC2 Spot). |
| `r/Paperlessngx` | [Reliable way to send scanned PDFs from Windows to Paperless-ngx (Hetzner + Docker setup)](https://www.reddit.com/r/Paperlessngx/comments/1so0dlz/reliable_way_to_send_scanned_pdfs_from_windows_to/) | 2026-04-17 | ~7 months | **No** | Likely archived; Hetzner-specific ingestion question. |
| `r/Paperlessngx` | [Recommendation for a VPS provider to host Paperless with private documents?](https://www.reddit.com/r/Paperlessngx/comments/1p2t72s/recommendation_for_a_vps_provider_to_host/) | 2025-11-21 | 1 year | **No** | Archived (>6 months old). |
| `r/Paperlessngx` | [How to store the media folder of Paperless-ngx on Azure Blob or AWS S3?](https://www.reddit.com/r/Paperlessngx/comments/1m4saw6/how_to_store_the_media_folder_of_paperlessngx_on/) | 2025-07-20 | 1y 4m | **No** | Archived (>6 months old). |
| `r/Paperlessngx` | [\[Help\] Paperless-ngx Not Storing Files in S3 (Uploads Working but Missing in S3)](https://www.reddit.com/r/Paperlessngx/comments/1iol0cg/help_paperlessngx_not_storing_files_in_s3_uploads/) | 2025-02-13 | 1y 9m | **No** | Archived (>6 months old) and already resolved. |
| `r/selfhosted` | [Cloud hosting for Paperless NGX? (for personal data)](https://www.reddit.com/r/selfhosted/comments/1lhumsy/cloud_hosting_for_paperless_ngx_for_personal_data/) | 2025-06-22 | 1y 5m | **No** | Archived (>6 months old). |
| `r/selfhosted` | [Paperless-NGX Setup with Cloud Hosting](https://www.reddit.com/r/selfhosted/comments/15nttd7/paperlessngx_setup_with_cloud_hosting/) | 2023-08-11 | 3y 3m | **No** | Archived (>6 months old). |
| `r/selfhosted` | [paperless-ngx on the Cloud](https://www.reddit.com/r/selfhosted/comments/13f5x4s/paperlessngx_on_the_cloud/) | 2023-05-12 | 3y 6m | **No** | Archived (>6 months old). |
| `r/selfhosted` | [Paperless NGX: OCR and Amazon S3?](https://www.reddit.com/r/selfhosted/comments/100xrqg/paperless_ngx_ocr_and_amazon_s3/) | 2023-01-02 | 3y 10m | **No** | Archived (>6 months old). |
