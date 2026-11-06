---
title: Evidence-Based Cost Analysis
description: Itemized monthly cost comparison between On-Demand and traditional cloud deployments.
---

One of the primary goals of Paperless-NGX On-Demand is bringing the cloud hosting cost down to the level of a cup of coffee per month, eliminating the financial barrier for home and personal users.

---

## 1. Itemized Monthly Cost Breakdown (On-Demand)

The table below reflects AWS pricing in `us-east-1` (US East, N. Virginia) for an active personal user storing **10 GB of documents** (~5,000 pages of scanned receipts and PDFs) and accessing the system for **1 hour per day**:

| Service Component | Configuration & Usage | Monthly Cost | Notes |
| :--- | :--- | :--- | :--- |
| **EC2 Compute** | `t4g.medium` (2 vCPU, 4 GB RAM)<br>30 active hours/mo @ \$0.0336/hr | **\$1.01** | **\$0.00/hour** when stopped during idle periods. |
| **EBS Storage** | 10 GB gp3 root volume @ \$0.080/GB-mo | **\$0.80** | Stores OS, SQLite DB, and Whoosh index. |
| **S3 Storage** | 10 GB Standard @ \$0.023/GB-mo | **\$0.23** | Stores document binaries, thumbnails, and backups. |
| **CloudFront CDN** | Edge distribution & KeyValueStore | **\$0.00** | Covered under Always-Free Tier (1 TB transfer & 10M requests/mo). |
| **AWS Lambda** | Wakeup function (< 1,000 invocations/mo) | **\$0.00** | Covered under Always-Free Tier (1,000,000 requests/mo). |
| **VPC Gateway Endpoint** | S3 Gateway Endpoint | **\$0.00** | Free of charge; zero data transfer fees to S3. |
| **ACM TLS Certificate** | Public wildcard or subdomain certificate | **\$0.00** | Free SSL/TLS certificates provided by AWS. |
| **Total Cloud Bill** | **Typical Active Usage (1 hr/day)** | **\$2.04 / month** | |

### Sensitivity Analysis: What If You Use It More?
- **Light User (30 minutes/day)**: 15 active hours = **\$1.53 / month**.
- **Average User (1 hour/day)**: 30 active hours = **\$2.04 / month**.
- **Heavy User (2 hours/day)**: 60 active hours = **\$3.05 / month**.
- **Travel / Vacation (0 hours/day)**: 0 active hours = **\$1.03 / month** (Storage only).

---

## 2. Comparison: On-Demand vs. Traditional 24/7 Cloud Architectures

Standard tutorials for hosting Docker containers or Paperless on AWS typically prescribe 24/7 managed services. Here is what that actually costs:

| Resource | Traditional 24/7 Architecture | On-Demand (This Project) | Monthly Savings |
| :--- | :--- | :--- | :--- |
| **Compute** | 24/7 EC2 `t4g.medium` (730 hrs) = **\$24.53** | Scale-to-Zero EC2 (30 hrs) = **\$1.01** | \$23.52 / mo |
| **Database** | Amazon RDS PostgreSQL `db.t4g.micro` = **\$18.25** | Local NVMe SQLite + S3 snapshots = **\$0.00** | \$18.25 / mo |
| **Networking** | AWS NAT Gateway (730 hrs + data) = **\$32.85** | Public subnet + Free S3 Gateway Endpoint = **\$0.00** | \$32.85 / mo |
| **File Storage** | Amazon EFS (10 GB general purpose) = **\$3.00** | S3 Standard + gp3 EBS = **\$1.03** | \$1.97 / mo |
| **Total Monthly Cost** | **\$78.63+ / month** | **\$2.04 / month** | **97.4% Savings** |

---

## 3. External Prerequisites Costs (Outside AWS Infrastructure)

To maintain complete transparency, the following items are managed outside the AWS deployment stack:

| Item | Provider | Approximate Cost | Frequency |
| :--- | :--- | :--- | :--- |
| **Domain Registration** | Cloudflare, Namecheap, Route 53, Porkbun | **\$8.00 – \$14.00** | Per Year (~**\$0.85/month**) |
| **AWS Account Account Base** | Amazon Web Services | **\$0.00** | Free to open and maintain |
| **DNS Hosting** | Cloudflare Free DNS or Route 53 Hosted Zone | **\$0.00 – \$0.50** | Free (Cloudflare) or \$0.50/mo (Route 53) |

> [!TIP]
> If you already own a personal domain hosted on Cloudflare or another DNS provider, you can add a `pod.yourdomain.com` CNAME pointing to CloudFront with **zero additional DNS hosting costs**.

