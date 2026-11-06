---
title: Community Outreach & Discussion Templates
description: Ready-to-use posts and discussion starters for Reddit, GitHub Discussions, and community issue replies.
---

These ready-to-use templates are designed for sharing the **Paperless-NGX On-Demand** solution with the self-hosted and home archivist communities.

Each draft includes:
1. An **evidence-based monthly cost breakdown** ($2.04/mo).
2. Explicit callouts for **external prerequisites** managed outside the repo (AWS account, domain/DNS, ACM certificate).
3. A respectful invitation to test, provide feedback, and contribute.

---

## Post 1: Reddit (`r/selfhosted`)

**Target**: `r/selfhosted`  
**Flair**: `Show & Tell` or `Resource / Guide`  
**Title**: `I built a Paperless-NGX AWS architecture that scales to $0/hr when idle (~$2/month total) with instant browser wake-up`

```markdown
Hey r/selfhosted,

Like many of you, I love Paperless-NGX for managing documents, tax receipts, and home paperwork. But as a single user scanning maybe 10–20 documents a month, keeping a dedicated VPS or always-on EC2 instance running 24/7 meant paying $15–$30/month for compute that was idle 99% of the time.

Home lab hardware (like a Raspberry Pi 4) is great, but maintaining backups, managing Dynamic DNS, port forwarding, and dealing with SD card wear or ISP outages wasn't ideal for my setup.

So I designed and open-sourced **Paperless-NGX On-Demand** — an AWS CDK infrastructure-as-code project that runs full Paperless-NGX in the cloud while automatically scaling compute to $0/hr when you aren't using it.

Repo: https://github.com/plthomasva/paperless-ngx-on-demand
Documentation: https://plthomasva.github.io/paperless-ngx-on-demand/

---

### How It Works

1. **Edge Routing (CloudFront + KeyValueStore)**:
   A CloudFront distribution terminates TLS at edge locations. A lightweight CloudFront Function checks KeyValueStore (KVS) on each request for instance state.

2. **Zero-Latency Splash & Auto-Wakeup**:
   When compute is stopped, requests route to a Lambda Function URL that renders a dark-mode splash screen. Browser JavaScript requests status from the wakeup endpoint, which issues an EC2 `StartInstances` call. (Known crawler bots and scanner probes are blocked with 403/404 so they don't wake your instance).

3. **Fast Graviton Compute**:
   The backend runs on an ARM64 `t4g.medium` instance. On boot, `boot-sync.sh` mounts your S3 media library via AWS `mount-s3`, verifies Paperless-NGX on port 8000, updates CloudFront KVS to `running`, and writes the dynamic origin IP. The browser splash screen immediately transitions to the Paperless login screen (~15–25s total wake time).

4. **Multi-Layer Task-Draining Watchdog**:
   A background daemon monitors UI activity, Redis Celery queues, `/api/tasks/` endpoints, and OCR/Tesseract processes. It ensures the instance **never** halts while indexing or processing documents. Once idle for 15 minutes with all queues drained, it executes an online SQLite `.backup` to S3 and calls `shutdown -h now`.

---

### Evidence-Based Monthly Cost Analysis

| Component | Usage Tier | Monthly Cost |
| :--- | :--- | :--- |
| **EC2 Compute (`t4g.medium`)** | ~10 hours active usage/month ($0.0336/hr) | **$0.34** |
| **EBS Storage (15 GB gp3)** | Boot OS, SQLite DB, Whoosh full-text index ($0.08/GB-mo) | **$1.20** |
| **EBS gp3 Snapshot** | Daily automated snapshot delta (~5 GB) | **$0.25** |
| **S3 Media & Backups** | 5 GB storage with standard tier ($0.023/GB) | **$0.12** |
| **AWS Lambda** | ~500 wake-ups and health polls/month (Always Free Tier) | **$0.00** |
| **CloudFront & Edge Functions** | < 10,000 requests/month (Always Free Tier up to 1 TB) | **$0.00** |
| **CloudFront KeyValueStore** | Free tier reads | **$0.00** |
| **Estimated Total** | **Real-world typical home archivist usage** | **~$1.91 – $2.04 / month** |

*(If you use an existing domain hosted on Cloudflare or Route 53, DNS adds $0.00 to $0.50/mo).*

---

### Prerequisites (Outside the CDK Project)

To keep things transparent, here is what needs to be set up outside the repo:
1. **An AWS Account**: Standard AWS account with CLI credentials configured.
2. **A Domain Name**: Registered anywhere (Cloudflare, Namecheap, Route 53, etc.).
3. **External or Route 53 DNS**: A CNAME pointing your subdomain (e.g., `pod.yourdomain.com`) to CloudFront.
4. **ACM Certificate**: A free AWS Certificate Manager SSL certificate created in `us-east-1`.

Everything else (VPC, Security Groups, IAM least-privilege roles, EC2, Lambda, S3, CloudFront, KeyValueStore, systemd services) is 100% automated via `npm run cdk:deploy`.

---

### Feedback & Collaboration

The project is published under CC-BY-NC 4.0 (attribution to Paperless-NGX under GPL-3.0 for assets).

I’d love for anyone in the community interested in on-demand cloud self-hosting to give it a try or review the architecture! PRs, issues, and discussions are warmly welcome on GitHub.
```

---

## Post 2: GitHub Discussions (`paperless-ngx/paperless-ngx`)

**Category**: `Show and tell`  
**Title**: `Paperless-NGX On-Demand: Zero-Idle Cloud Architecture with Task-Draining Watchdog (~$2/month on AWS)`

```markdown
Hello Paperless-NGX community!

I wanted to share a project I recently open-sourced that brings an automated, zero-cost-idle architecture to Paperless-NGX on AWS:

🔗 **GitHub Repository**: https://github.com/plthomasva/paperless-ngx-on-demand  
📖 **Live Documentation**: https://plthomasva.github.io/paperless-ngx-on-demand/

### Why build this?
Many personal and home users want the reliability and offsite durability of cloud hosting, but paying for a 24/7 VPS or cloud server for occasional document indexing is overkill.

Existing "serverless" approaches often struggle with Paperless-NGX because it relies on persistent background Celery workers, Redis, Tesseract OCR, and Whoosh full-text search indexing that cannot run cleanly on ephemeral containers without severe cold starts or broken indexing state.

### Architecture Highlights:
- **CloudFront + KeyValueStore Router**: Global edge distribution routes web traffic. When compute is cold, users receive an instant dark-mode splash page (~50ms) while the instance boots.
- **Fast Graviton Instance (`t4g.medium`)**: Boots in ~15–25 seconds. On boot, `mount-s3` mounts the S3 media library, starts Docker Compose, verifies Paperless health on port 8000, and updates KVS to route traffic directly to the instance.
- **Task-Draining Watchdog**: The instance only shuts down when:
  1. No web requests for 15 minutes (`/tmp/access.log`).
  2. Redis Celery queue is empty (`LLEN celery == 0`).
  3. No active jobs in `/api/tasks/`.
  4. No OCR (`tesseract`, `ocrmypdf`) processes running.
  5. S3 consume inbox is drained.
- **Online Database Durability**: Uses SQLite's online `.backup` API to flush WAL journals and upload consistent database snapshots to S3 before halting.
- **Monthly Cost**: **~$1.90 – $2.04/month** total for typical home archivist volume.

### External Setup Requirements:
- AWS Account
- Domain name & DNS (e.g. Cloudflare or Route 53)
- Free AWS ACM SSL Certificate in `us-east-1`

Feedback, suggestions, and architectural reviews from the community are warmly welcome!
```

---

## Post 3: Issue / Forum Reply Template

**Context**: Replying to GitHub/GitLab issues or forum threads where users discuss cloud hosting costs, scale-to-zero, or running Paperless cheaply without local hardware.

```markdown
Hi @[username],

If you're still looking for a cost-effective way to host Paperless-NGX in the cloud without paying $20+/mo for a 24/7 VPS, you might want to look at **Paperless-NGX On-Demand**:

🔗 https://github.com/plthomasva/paperless-ngx-on-demand
📖 Docs: https://plthomasva.github.io/paperless-ngx-on-demand/

It uses AWS CDK to deploy an automated scale-to-zero architecture:
- When idle, compute scales to $0/hr. Total AWS monthly cost is ~$2.04/mo (mostly 15 GB EBS storage and S3 storage).
- When you visit your URL, CloudFront shows an instant splash screen and wakes an ARM64 EC2 instance (~15–25s wake time).
- A task-draining watchdog ensures the instance never sleeps while OCR, Celery queues, or consumption jobs are running, and backs up SQLite to S3 before halting.
- S3 bucket notifications also trigger headless wake-up if you drop files into the inbox from mobile shortcuts or email forwarders.

The only manual prerequisites outside the CDK deployment are an AWS account, a domain name, and an ACM SSL certificate. Hope this helps anyone looking for a reliable cloud alternative!
```
