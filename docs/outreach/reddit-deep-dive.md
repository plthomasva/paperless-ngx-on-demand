# Reddit Deep-Dive Outreach Drafts (`r/Paperlessngx` & `r/selfhosted`)

> **Status:** Ready-to-post drafts (manual submission required — no Reddit credentials or `praw` session exist in this environment).
> **Repo verified against:** [`plthomasva/paperless-ngx-on-demand`](https://github.com/plthomasva/paperless-ngx-on-demand) (`v1.2.5`, commit `731cb58`).

---

## 1. `r/Paperlessngx` — Full Engineering Case Study

> **Before posting:** Open `https://www.reddit.com/r/Paperlessngx/` in your browser to spot-check the current sidebar rules and select the appropriate post flair (e.g., `Discussion`, `Guide`, or `Showcase`).

### Title

```text
How I got Paperless-NGX running on AWS for ~$2/month with scale-to-zero (and the $14.56 overnight polling bug I hit along the way)
```

### Body

I wanted to host Paperless-NGX in the cloud so it's accessible from anywhere without leaving a home server running 24/7, but standard AWS tutorials for Paperless (24/7 EC2 + RDS Postgres + NAT Gateway + EFS) easily land at **$78+/month**.

So I built an open-source AWS CDK v2 setup ([paperless-ngx-on-demand](https://github.com/plthomasva/paperless-ngx-on-demand)) that scales compute all the way down to **EC2 `stopped` ($0/hr)** when idle and wakes up on demand in ~45–60 seconds when you visit the URL or drop a PDF into S3.

Here's the architecture, the cost breakdown, and the **$14.56 overnight billing bug** I ran into (and fixed in v1.2.5).

---

### Architecture: Making a Stateful, Celery-Heavy App Scale to Zero

Paperless-NGX doesn't fit cleanly into stateless containers like Lambda or scale-to-zero Fargate because it relies on Redis, Celery workers, Tesseract/OCRmyPDF subprocesses, a local search index (Whoosh), and a database. Stopping it mid-OCR risks corrupting state.

Instead, the stack uses a **single-instance Graviton VM (`t4g.medium`, 2 vCPU / 4 GB RAM)** with CloudFront + a KeyValueStore acting as a traffic switch at the edge:

1. **Cold state (EC2 stopped, $0/hr compute):**
   - Requests hit **CloudFront**, which runs a **CloudFront Function (JS 2.0)** on `VIEWER_REQUEST` (`lib/constructs/edge-router.ts`).
   - It reads `status` and `originDomain` from **CloudFront KeyValueStore (KVS)**.
   - When `status !== 'running'`, traffic falls through to the default origin: a **Lambda Function URL** (256 MB, Node.js 22.x) that returns a dark-mode wake-up splash page in ~50ms (`lib/lambda/wakeup-page.ts`).
   - Crawler/bot User-Agents, `/robots.txt`, `/favicon.ico`, and common vulnerability probes (`.php`, `.env`, `/wp-login`, etc.) are rejected or served directly by Lambda **without** waking EC2.

2. **Wake-up & boot (`runtime/boot-sync.sh`):**
   - When a real browser loads the splash page, client-side JS calls `/__wakeup/status?action=wake`, which triggers `StartInstancesCommand` on the `t4g.medium` instance. (Dropping files into the S3 `consume/` prefix also triggers the Lambda via `s3:ObjectCreated`.)
   - On boot, `boot-sync.sh` restores `/mnt/data/db.sqlite3` from S3 if needed, mounts the S3 media bucket via **`mount-s3`** (Mountpoint for Amazon S3) over a free **S3 Gateway VPC Endpoint** (`$0` transfer, no NAT Gateway), starts Docker Compose (`nginx:alpine` on `:8000` -> `paperless-ngx` on `127.0.0.1:8080` + `redis:7-alpine`), waits for `/__health` and `/api/` to pass, grabs its ephemeral public IPv4/hostname via IMDSv2, and writes `originDomain` + `status='running'` to CloudFront KVS.
   - The splash page sees `state === 'running'` and redirects straight into Paperless-NGX.

3. **6-layer task-draining watchdog (`runtime/watchdog.sh`):**
   - Nginx logs UI requests to `/tmp/access.log` (ignoring `/__health`, `/static/`, `/robots.txt`, `/favicon.ico`).
   - Once the UI has been idle for **15 minutes** (`IDLE_TIMEOUT_SECONDS=900`), `watchdog.sh` checks every 60s and refuses to shut down unless **all 6 layers** are clear for **2 consecutive checks**:
     1. No `/tmp/paperless_maintenance.lock` file
     2. No non-zero-byte files waiting in `s3://<bucket>/consume/` (pulls them in if found)
     3. `/mnt/consume` is empty
     4. Redis Celery queue is empty (`LLEN celery == 0`)
     5. Paperless `/api/tasks/` reports zero `PENDING`, `STARTED`, or `RETRY` tasks
     6. No active `tesseract`, `ocrmypdf`, or `gs` processes running
   - When clean, it sets KVS `status='stopped'`, runs `backup-data.sh` (`sqlite3 .backup` online snapshot + Whoosh index + `manage.py dumpdata` `manifest.json` -> `.tar.gz` uploaded to S3), stops Docker Compose, unmounts `mount-s3`, and runs `shutdown -h now`. (An EventBridge rule on EC2 state changes also resets KVS if the instance stops unexpectedly.)

---

### Monthly Cost Breakdown (1 hr/day active, 10 GB docs, `us-east-1`)

| Component | Traditional 24/7 AWS | This Setup (On-Demand) |
| :--- | :--- | :--- |
| **EC2 Compute** | `t4g.medium` 24/7 (730 hrs) = **$24.53** | `t4g.medium` (30 hrs @ $0.0336/hr) = **$1.01** |
| **Database** | RDS PostgreSQL `db.t4g.micro` = **$18.25** | Local SQLite + S3 `.backup` snapshots = **$0.00** |
| **Networking** | NAT Gateway (730 hrs) = **$32.85** | Public subnet + free S3 Gateway Endpoint = **$0.00** |
| **Storage** | EFS (10 GB) = **$3.00** | 10 GB `gp3` EBS ($0.80) + 10 GB S3 ($0.23) = **$1.03** |
| **CloudFront + KVS + Lambda + ACM** | — | **$0.00** (Always-Free Tier / free) |
| **Total** | **$78.63+/month** | **$2.04/month** (97.4% savings) |

*(Sensitivity: 0.5 hr/day = $1.53/mo; 2 hrs/day = $3.05/mo; 0 hrs/day storage-only = $1.03/mo.)*

---

### The $14.56 Overnight Polling Bug (Issue #33 / PR #34 / v1.2.5)

The "free" CloudFront KVS line item above had a painful catch that I learned the hard way:

- **CloudFront Function** `kvs.get()` reads at the edge are practically free.
- **AWS SDK `GetKeyCommand`** calls from Lambda (`@aws-sdk/client-cloudfront-keyvaluestore`) are billed at **$0.001 per `GetKey` API call** ($1.00 per 1,000 calls).

One evening during a CDK deployment, I left a wake-up splash page open in a browser tab while the EC2 instance stayed stopped. At the time, `wakeup-page.ts` polled `/__wakeup/status` every **2 seconds** indefinitely (`setTimeout(checkStatus, 2000)`), and the Lambda handler called `GetKeyCommand` on every single poll.

Over ~14 hours overnight, that single abandoned tab generated ~16,500 Lambda invocations and **14,558 billed `KeyValueStore-APIOperations` (`GetKey`) = $14.56** on my AWS bill.

**The fix (PR #34, released in v1.2.5):**
1. Increased `POLL_INTERVAL_MS` from `2000` to `5000` (60% fewer polls per wake).
2. Added a `document.hidden` check + `visibilitychange` listener so background tabs pause polling completely until focused.
3. Added a **15-minute `MAX_POLL_DURATION_MS` timeout** — if the server isn't up after 15 minutes, polling stops and shows a *"Check again"* (`#retry-btn`) button.
4. Added a **15-second module-scope TTL cache** (`STATUS_CACHE_TTL_MS = 15 * 1000`) in `lib/lambda/wakeup-handler.ts` for `getKvsStatus()` and `getInstanceState()` (invalidated on `updateKvsKey()`, `StartInstancesCommand`, and `RebootInstancesCommand`), so even active polling barely touches the KVS control/data-plane API.

Repo (`CC-BY-NC-4.0`, TypeScript AWS CDK v2): https://github.com/plthomasva/paperless-ngx-on-demand

Happy to answer questions about the `mount-s3` behavior, SQLite backup/restore flow, or CloudFront KVS routing!

---

## 2. `r/selfhosted` — Adapted Case Study (Standalone Post)

> **Important `r/selfhosted` Rules Check:**
> 1. **3-Month Rule:** `paperless-ngx-on-demand` was announced Nov 7, 2026 (~19 days old as of Nov 26, 2026). Standalone *new project showcase* posts for projects <3 months old are removed by mods and redirected to the **New Project Megathread**. If you post a standalone thread on `r/selfhosted`, frame it strictly as an **engineering post-mortem / architecture case study** (draft below). If you want to showcase it as a new project, use **Section 3 (New Project Megathread Entry)** instead.
> 2. **AI-Compliance Auto Comment Bot:** Most new posts on `r/selfhosted` are auto-removed with a bot comment asking how AI was involved. Reply immediately using **Section 4** below so the post is auto-approved.

### Title

```text
Case Study: Scaling a stateful app (Paperless-NGX) to zero on AWS for ~$2/mo — and the $14.56 overnight KVS polling bug
```

### Body

Most "scale-to-zero" tutorials assume a stateless HTTP service you can stick on Lambda or Cloud Run. Paperless-NGX is the opposite: it runs Django, Redis, Celery workers, `tesseract`/`ocrmypdf` subprocesses, a Whoosh search index, and a database. If you kill it mid-job, you risk corrupted OCR or half-written state.

I wanted cloud access without paying **$78.63+/month** for a 24/7 EC2 + RDS Postgres + NAT Gateway + EFS stack, so I put together a CDK v2 architecture that runs on a single Graviton `t4g.medium`, stops to `$0/hr` compute when idle, and wakes up in ~45–60s on demand. Here are the two hardest engineering problems I hit—and a $14.56 billing mistake from one line of polling JS.

#### 1. Routing to Ephemeral EC2 IPs Without an ALB or Elastic IP

When an EC2 instance stops and starts in a public subnet, its public IP changes. Instead of paying for an ALB or NAT Gateway:
- **CloudFront** fronts the app and runs a **CloudFront Function (JS 2.0)** on `VIEWER_REQUEST` (`lib/constructs/edge-router.ts`).
- The function reads `status` and `originDomain` from **CloudFront KeyValueStore (KVS)**.
- If `status !== 'running'`, CloudFront routes to the default origin: a **Lambda Function URL** that serves a 50ms dark-mode wake-up page (and blocks crawlers/scanners like `.php`/`.env`/`/wp-login` without waking EC2).
- Once EC2 boots, `boot-sync.sh` fetches its new IPv4/hostname via IMDSv2, converts raw IPv4s to `ec2-<dashed-ip>.compute-1.amazonaws.com` (because `cf.updateRequestOrigin` rejects raw IPs), and writes `originDomain` + `status='running'` to KVS.

#### 2. Draining Celery + OCR Before `shutdown -h now`

The watchdog (`runtime/watchdog.sh`) tracks real user traffic via an Nginx activity proxy on `:8000` (`/tmp/access.log`, excluding `/__health` and `/static/`). After **15 minutes** of UI idle, it requires **2 consecutive clean passes** (60s apart) across 6 checks before shutting down:
1. No `/tmp/paperless_maintenance.lock`
2. No non-zero files in `s3://<bucket>/consume/`
3. Empty `/mnt/consume`
4. Redis `LLEN celery == 0`
5. Paperless `/api/tasks/` has 0 `PENDING|STARTED|RETRY` tasks
6. No active `tesseract`, `ocrmypdf`, or `gs` processes

Only then does it flip KVS to `stopped`, run `sqlite3 .backup` + `manage.py dumpdata` to S3, stop Docker Compose, unmount `mount-s3`, and `shutdown -h now`.

**Resulting cost (1 hr/day active, 10 GB docs, `us-east-1`):**
- `t4g.medium` (30 hrs @ $0.0336/hr): **$1.01**
- 10 GB `gp3` EBS ($0.80) + 10 GB S3 ($0.23): **$1.03**
- CloudFront / KVS / Lambda / S3 Gateway Endpoint / ACM: **$0.00**
- **Total: $2.04/month** (vs. $78.63+/month 24/7).

#### 3. The $14.56 Overnight Bug (KVS Edge Reads vs. SDK `GetKey`)

Here's the AWS gotcha that bit me: **CloudFront Function** `kvs.get()` calls at the edge are included in the free tier, but calling **`GetKeyCommand` via the AWS SDK from Lambda** bills **$0.001 per `GetKey` operation**.

I left a wake-up splash tab open overnight during a deployment while EC2 stayed stopped. The splash page polled `/__wakeup/status` every 2 seconds with no timeout and no tab-visibility check. By morning: ~16,500 Lambda calls and **14,558 billed `GetKey` operations = $14.56**.

Fixed in v1.2.5 (PR #34):
- Bumped polling from 2s to **5s**
- Paused polling when `document.hidden` is true (`visibilitychange`)
- Added a **15-minute give-up cap** with a manual *"Check again"* button
- Added a **15-second in-memory TTL cache** in the Lambda handler (`STATUS_CACHE_TTL_MS = 15 * 1000`)

Code & CDK stack (if you want to inspect the watchdog or edge router): https://github.com/plthomasva/paperless-ngx-on-demand

---

## 3. `r/selfhosted` — Weekly New Project Megathread Entry (<3-Month Rule)

> **When to use:** Post this as a comment in the current week's **New Project Megathread** on `r/selfhosted` (posted every Friday; you can comment any day of the week).

```markdown
**Project:** Paperless-NGX On-Demand (`v1.2.5`)
**Source / Repo:** https://github.com/plthomasva/paperless-ngx-on-demand
**License:** CC-BY-NC-4.0

**What it is:**
An AWS CDK v2 deployment that runs Paperless-NGX on-demand with true scale-to-zero (`$0/hr` compute when idle), bringing a personal 10 GB / 1 hr/day setup down from ~$78.63/mo (24/7 EC2 + RDS + NAT Gateway + EFS) to **~$2.04/mo** (`t4g.medium` Graviton + 10 GB gp3 EBS + 10 GB S3 + free S3 Gateway Endpoint).

**How it works:**
- **Edge routing:** CloudFront + CloudFront Function (JS 2.0) + CloudFront KeyValueStore routes to a 50ms Lambda wake-up splash page when cold, or directly to the EC2 `:8000` Nginx proxy when warm.
- **Boot & storage:** `boot-sync.sh` mounts S3 media via `mount-s3`, restores SQLite from S3 snapshots if needed, starts Docker Compose (`paperless-ngx` + `redis`), and registers the ephemeral EC2 IP in KVS.
- **6-layer task-draining watchdog:** `watchdog.sh` waits for 15m UI idle + 2 consecutive clean checks across maintenance lock, S3 `consume/`, `/mnt/consume`, Redis `LLEN celery`, `/api/tasks/`, and `tesseract`/`ocrmypdf`/`gs` processes, then runs `sqlite3 .backup` + `manage.py dumpdata` to S3 before `shutdown -h now`.
- **Recent fix (v1.2.5 / Issue #33):** Capped splash-page polling (5s interval, `document.hidden` pause, 15m timeout) and added a 15s Lambda KVS status cache after an abandoned tab racked up 14,558 `GetKey` calls ($14.56) overnight.

**AI Involvement:**
AI coding/writing assistants were used to help draft documentation, boilerplate CDK/TypeScript tests, and parts of this write-up; all architecture, AWS deployment testing, and code changes were personally reviewed, run, and verified by me.
```

---

## 4. `r/selfhosted` — Ready-to-Paste Reply to the AI-Compliance Auto Comment Bot

> **Instructions:** Immediately after submitting a standalone post on `r/selfhosted`, AutoModerator will remove it and leave a sticky comment asking how AI was involved. Paste a reply like this (adjusting the wording so it accurately reflects your own workflow):

```text
AI involvement disclosure: AI tools were used to assist with drafting documentation, test scaffolding, and editing this post for clarity. The AWS CDK architecture, runtime scripts (`watchdog.sh`, `boot-sync.sh`), live AWS deployment, and the Issue #33 / v1.2.5 billing bug investigation and fix were all personally built, tested, and verified by me.
```
