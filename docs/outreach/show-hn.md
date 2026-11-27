# Hacker News (`Show HN`) Submission Guide

> **Status:** Manual submission required (no Hacker News credentials or browser session exist in this environment).
> **Repo verified against:** [`plthomasva/paperless-ngx-on-demand`](https://github.com/plthomasva/paperless-ngx-on-demand) (`v1.2.5`, commit `731cb58`).

---

## 1. Submission Fields

- **URL:** `https://github.com/plthomasva/paperless-ngx-on-demand`
- **Title:** `Show HN: Scale-to-zero Paperless-NGX on AWS (~$2/mo) via CloudFront KVS and Graviton`

---

## 2. ⚠️ CRITICAL: Hacker News AI-Comment Policy

Per official Hacker News guidelines ([`https://news.ycombinator.com/newsguidelines.html#generated`](https://news.ycombinator.com/newsguidelines.html#generated)):

> **AI-generated or AI-edited comments are strictly forbidden on Hacker News and are automatically killed by HN moderation software.**
> *(HN moderators explicitly state: "It's fine, of course, to use AI tools—we use them heavily ourselves. Just please don't use them to generate or edit text to be read by fellow humans on Hacker News.")*

Because of this rule:
- **Do NOT** copy-paste AI-written or AI-edited text into a HN maker's comment or into any reply on HN.
- **No pre-written AI comments are provided in this file.**
- Use the verified technical facts below only as **reference bullet points** when writing your own comments in your own words.

---

## 3. Show HN Submission Checklist

Per [`https://news.ycombinator.com/showhn.html`](https://news.ycombinator.com/showhn.html):
- [ ] **Established account:** `Show HN` is restricted for brand-new HN accounts; submit from your own established account.
- [ ] **Personally built & tryable:** Confirm the README has a clear Quick Start (`npm run setup` / `cdk deploy`) and demo GIF (`assets/demo.gif`) so readers can understand and try it immediately.
- [ ] **Be around to discuss:** Plan to stick around for a couple of hours after submitting to answer technical questions in your own words.
- [ ] **No vote solicitation:** Do not ask friends or social channels to upvote or comment on the HN submission.

---

## 4. Verified Technical Talking Points (Write in Your Own Words)

If you write a brief maker's comment or answer questions in the thread, these facts are verified directly against the codebase:

- **Problem:** Paperless-NGX is stateful and worker-heavy (Django + Redis + Celery + `tesseract`/`ocrmypdf` + Whoosh search index + DB), so stateless scale-to-zero platforms (Lambda, Cloud Run, scale-to-zero Fargate) are a poor fit, while a standard 24/7 AWS setup (EC2 + RDS + NAT Gateway + EFS) costs **$78.63+/mo**.
- **Edge routing (`lib/constructs/edge-router.ts`):** CloudFront + CloudFront Function (`JS_2_0`) reads `status` and `originDomain` from CloudFront KeyValueStore (KVS) on `VIEWER_REQUEST`. When cold, requests hit a Lambda Function URL returning a ~50ms dark-mode splash screen (`lib/lambda/wakeup-page.ts`). When warm, `cf.updateRequestOrigin` routes directly to the EC2 instance's `:8000` Nginx proxy (converting raw IPv4s to `ec2-<dashed-ip>.compute-1.amazonaws.com` because `updateRequestOrigin` rejects raw IPs).
- **Storage & networking (`lib/paperless-on-demand-stack.ts`, `runtime/boot-sync.sh`):** 1-AZ VPC with 0 NAT Gateways + a free S3 Gateway VPC Endpoint (`$0` S3 transfer). `t4g.medium` (Graviton ARM64) mounts S3 media via `mount-s3` and keeps SQLite + Whoosh on a 10 GB `gp3` EBS volume, restoring/backing up via `sqlite3 .backup` + `manage.py dumpdata` to S3 (`runtime/backup-data.sh`).
- **6-layer task-draining watchdog (`runtime/watchdog.sh`):** Nginx logs real UI traffic to `/tmp/access.log` (excluding `/__health` and `/static/`). After 15 minutes idle + 2 consecutive clean passes across (1) maintenance lock, (2) S3 `consume/`, (3) `/mnt/consume`, (4) Redis `LLEN celery`, (5) `/api/tasks/` (`PENDING|STARTED|RETRY`), and (6) active `tesseract`/`ocrmypdf`/`gs` processes, it updates KVS to `stopped`, backs up to S3, stops containers, unmounts `mount-s3`, and runs `shutdown -h now`.
- **Cost (`docs/src/content/docs/cost-analysis.md`):** At 1 hr/day (30 hrs/mo) and 10 GB docs in `us-east-1`: EC2 `t4g.medium` `$1.01` + 10 GB `gp3` EBS `$0.80` + 10 GB S3 `$0.23` + `$0.00` CloudFront/KVS/Lambda/S3 Endpoint/ACM = **$2.04/month** (97.4% lower than $78.63+/mo).
- **Issue #33 / PR #34 / v1.2.5 post-mortem:** An abandoned splash-page tab polled `/__wakeup/status` every 2s overnight during a deploy, triggering 14,558 AWS SDK `GetKey` calls at $0.001 each (**$14.56**). Fixed in v1.2.5 with a 5s poll interval, `document.hidden` pause, 15m give-up timeout + `#retry-btn`, and a 15s in-memory TTL cache in `lib/lambda/wakeup-handler.ts`.
