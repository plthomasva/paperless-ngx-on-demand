---
title: Overview & Architecture
description: How Paperless-NGX On-Demand achieves zero idle compute cost with CloudFront edge routing.
---

## The Problem with Traditional Cloud Self-Hosting

Paperless-NGX is an exceptional open-source document management system, but hosting it in public cloud infrastructure typically creates prohibitive monthly bills:
- Always-on EC2 instances (even modest `t4g.small` or `t3.medium`) run 730 hours/month.
- Managed relational databases (Amazon RDS PostgreSQL) add $20–$40/month.
- Elastic File System (EFS) or provisioned storage carries continuous hourly IOPS and throughput charges.
- NAT Gateways add ~$32/month just for idle routing.

For a personal home archivist scanning a handful of utility bills, tax receipts, or medical forms per week, a $70–$100/month bill is hard to justify when a physical Raspberry Pi runs at home for pennies in electricity. However, home servers suffer from hardware failures, power outages, SD card corruption, and port-forwarding security risks.

## The On-Demand Solution

**Paperless-NGX On-Demand** bridges this gap by deploying an Infrastructure-as-Code (AWS CDK in TypeScript) architecture designed specifically for **single-tenant personal archiving**:

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
            │                     ▼                      │
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

### Lifecycle Walkthrough

1. **Stopped State ($0.00/hr compute)**:
   The EC2 Graviton instance is stopped. The CloudFront KeyValueStore (KVS) maintains `instance_status: "stopped"`.
2. **User Arrives at Domain**:
   CloudFront Function inspects the KVS at edge (sub-millisecond). Seeing `"stopped"`, it dynamically routes the HTTP request to the Wakeup Lambda function.
3. **Instance Spin-Up**:
   The Wakeup Lambda issues an EC2 `StartInstances` API call and immediately responds with a fast, responsive HTML splash screen that polls the Lambda status every 3 seconds.
4. **Boot & Sync (< 40 seconds)**:
   The instance boots Amazon Linux 2023. The `boot-sync.sh` systemd service pulls the latest SQLite database backup from S3, mounts the S3 media bucket via `s3fs`, and launches Paperless-NGX and Redis via Docker Compose.
5. **Edge Switchover**:
   As soon as health checks succeed on port 8000, the instance updates the CloudFront KVS to `"running"`. Subsequent web requests route directly to EC2 with zero Lambda invocation latency.
6. **Task Drain & Safe Sleep**:
   A multi-layer watchdog monitors Celery task queues, HTTP traffic, OCR worker processes, and CPU utilization. When idle for 20 minutes with all indexing drained, it executes an automated SQLite `.backup`, syncs it to S3, updates KVS to `"stopped"`, and calls `aws ec2 stop-instances`.

