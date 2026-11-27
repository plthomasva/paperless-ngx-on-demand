# AWS & DevOps Article: CloudFront KeyValueStore + Ephemeral EC2 IPs

> **Status:** Ready-to-post drafts for `dev.to`, Hashnode, and `r/aws` (manual submission required — no dev.to, Hashnode, or Reddit credentials exist in this environment).
> **Repo verified against:** [`plthomasva/paperless-ngx-on-demand`](https://github.com/plthomasva/paperless-ngx-on-demand) (`v1.2.5`, commit `731cb58`).

---

## Publishing & Cross-Posting Notes

1. **Choose a canonical origin (`dev.to` or Hashnode):**
   - Publish on one platform first, copy its published URL, and set `canonical_url` (on `dev.to`) or **Original Article URL** (in Hashnode Draft Settings) on the second platform so search engines don't penalize duplicate content.
2. **`dev.to` AI-Assisted Disclosure Policy:**
   - Per [`https://dev.to/devteam/guidelines-for-ai-assisted-articles-on-dev-17n6`](https://dev.to/devteam/guidelines-for-ai-assisted-articles-on-dev-17n6), AI-assisted articles must disclose AI involvement either upfront via the `#ABotWroteThis` tag or inline in the article body. The frontmatter and disclosure note below include both options.
   - Do **not** use AI/bots to write comments on `dev.to`.
3. **Hashnode AI Policy:**
   - Hashnode allows AI-assisted content that is human-edited and retains your own voice/verification.

---

## 1. `dev.to` / Hashnode Full Technical Article

```markdown
---
title: "Using CloudFront KeyValueStore to Route Traffic to Ephemeral EC2 IPs"
published: false
description: "How to build a $0/idle dynamic origin router with CloudFront Functions 2.0, KeyValueStore, and Lambda — and avoid a $14.56 overnight GetKey billing trap."
tags: aws, cloudfront, serverless, devops, ABotWroteThis
# Uncomment and set to your Hashnode URL if publishing on Hashnode first:
# canonical_url: https://yourblog.hashnode.dev/using-cloudfront-keyvaluestore-to-route-traffic-to-ephemeral-ec2-ips
---

*Disclosure: AI tools assisted with drafting and editing this article; the AWS CDK implementation, runtime scripts, and production billing incident described below were built and verified in [`plthomasva/paperless-ngx-on-demand`](https://github.com/plthomasva/paperless-ngx-on-demand).*

If you want an EC2 instance to scale to zero (`stopped`, `$0/hr` compute) when idle, you quickly run into a networking problem: **when an EC2 instance in a public subnet stops and starts again, its public IPv4 address changes.**

The textbook AWS fix is to put an Application Load Balancer (ALB) in front of the instance (~$16+/month) or attach an Elastic IP (which now costs ~$3.60/month for any public IPv4, plus you still need a wake-up proxy when the instance is stopped).

There is a much cheaper pattern that costs **$0.00/month** at low/personal traffic: **CloudFront + CloudFront Functions (JS 2.0) + CloudFront KeyValueStore (KVS)**.

Here is how I implemented it for [Paperless-NGX On-Demand](https://github.com/plthomasva/paperless-ngx-on-demand) (`v1.2.5`), along with two non-obvious AWS gotchas I hit along the way.

---

## The Architecture

Every request hits a single CloudFront distribution whose **default origin** is a **Lambda Function URL** (serving a ~50ms dark-mode wake-up splash page). A **CloudFront Function (`JS_2_0`)** attached to `VIEWER_REQUEST` inspects CloudFront KeyValueStore:

- **Cold (`status !== 'running'`):** The CloudFront Function leaves the default origin untouched, so traffic goes to the Lambda splash page, which starts EC2 via `StartInstancesCommand`.
- **Warm (`status === 'running'` and `originDomain` is set):** The CloudFront Function dynamically rewrites the origin to the EC2 instance's current public hostname on port `8000` using `cf.updateRequestOrigin()`.

---

## 1. The Edge Router (`lib/constructs/edge-router.ts`)

Here is the actual CloudFront Function 2.0 code from `lib/constructs/edge-router.ts`:

```javascript
import cf from 'cloudfront';

async function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // Preserve the original viewer Host header so Nginx and Django recognize the public domain
  if (request.headers.host) {
    request.headers['x-forwarded-host'] = { value: request.headers.host.value };
  }

  // Status check and wake-up paths go straight to the default origin (Lambda Function URL)
  if (uri.startsWith('/__wakeup')) {
    return request;
  }

  try {
    const kvs = cf.kvs();
    var status = await kvs.get('status');
    var originDomain = await kvs.get('originDomain');

    if (status === 'running' && originDomain && originDomain.length > 0) {
      var targetDomain = originDomain;
      // CloudFront Functions cf.updateRequestOrigin forbids raw IP addresses and colons.
      // If originDomain is an IPv4 address, convert to canonical EC2 DNS hostname.
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(targetDomain)) {
        targetDomain = 'ec2-' + targetDomain.split('.').join('-') + '.compute-1.amazonaws.com';
      }
      cf.updateRequestOrigin({
        domainName: targetDomain,
        customOriginConfig: {
          port: 8000,
          protocol: 'http',
          sslProtocols: ['TLSv1.2']
        }
      });
    }
  } catch (err) {
    // On KVS lookup failure or cold state, route to default origin (Lambda splash screen)
  }

  return request;
}
```

### Gotcha #1: `cf.updateRequestOrigin` Forbids Raw IPv4 Addresses

If you pass `198.51.100.42` directly to `cf.updateRequestOrigin({ domainName })`, CloudFront Functions rejects it. You must pass a DNS hostname — such as AWS's canonical EC2 public DNS (`ec2-198-51-100-42.compute-1.amazonaws.com` in `us-east-1`, or `ec2-<dashed-ip>.<region>.compute.amazonaws.com` in other regions). Both `edge-router.ts` and the EC2 boot script (`runtime/boot-sync.sh`) normalize raw IPv4s to this format.

Also note the `x-forwarded-host` header preservation: because CloudFront rewrites the `Host` header to the EC2 origin hostname, forwarding `x-forwarded-host` lets Nginx/Django validate CSRF and `ALLOWED_HOSTS` against your custom domain.

---

## 2. Keeping KVS in Sync Across Boot, Idle Shutdown, and Crashes

Three places update KVS:
1. **On EC2 boot (`runtime/boot-sync.sh`):** After Docker containers pass local healthchecks on `:8000` and `:8080`, `boot-sync.sh` reads its public hostname from IMDSv2 and writes `originDomain` and `status='running'` to KVS (note: CloudFront KVS data-plane calls always require `--region us-east-1` and an `ETag` via `IfMatch`).
2. **On idle shutdown (`runtime/watchdog.sh`):** After 15 minutes of UI idle and 2 consecutive clean task-drain checks (S3 inbox, `/mnt/consume`, Redis `LLEN celery`, `/api/tasks/`, and active `tesseract`/`ocrmypdf`/`gs` processes), `watchdog.sh` sets KVS `status='stopped'`, waits 3s, backs up SQLite to S3, and runs `shutdown -h now`.
3. **On unexpected stop (`lib/lambda/wakeup-handler.ts`):** An EventBridge rule on `EC2 Instance State-change Notification` (`stopping`, `stopped`, `shutting-down`) invokes the Lambda to reset `status='stopped'` and `originDomain=''`.

---

## 3. Gotcha #2: The $14.56 Overnight `GetKey` Billing Trap (Issue #33)

Here is the cost trap that caught me off guard:

- **CloudFront Function** `kvs.get()` reads at the edge are practically free (covered by CloudFront's Always-Free Tier).
- **AWS SDK `GetKeyCommand`** calls from Lambda (`@aws-sdk/client-cloudfront-keyvaluestore`) are billed at **$0.001 per `GetKey` API operation** ($1.00 per 1,000 calls).

During a CDK deployment one night, I left the wake-up splash page open in a browser tab while the EC2 instance stayed stopped. At the time, the splash page polled `/__wakeup/status` every **2 seconds** forever, and `wakeup-handler.ts` called `GetKeyCommand` on every poll.

Over ~14 hours, that single abandoned tab generated **14,558 billed `GetKey` calls = $14.56** ([Issue #33](https://github.com/plthomasva/paperless-ngx-on-demand/issues/33)).

### The Fix (`lib/lambda/wakeup-handler.ts` + `lib/lambda/wakeup-page.ts`, v1.2.5)

In [PR #34](https://github.com/plthomasva/paperless-ngx-on-demand/pull/34), I fixed both sides:

1. **In-memory 15-second TTL cache in Lambda (`lib/lambda/wakeup-handler.ts`):**

```ts
const STATUS_CACHE_TTL_MS = 15 * 1000;

let kvsStatusCache: { kvsArn: string; value: string; expiresAt: number } | null = null;

export async function getKvsStatus(kvsArn: string): Promise<string> {
  if (!kvsArn) return 'unknown';
  const now = Date.now();
  if (kvsStatusCache && kvsStatusCache.kvsArn === kvsArn && now < kvsStatusCache.expiresAt) {
    return kvsStatusCache.value;
  }
  try {
    const res = await kvs.send(new GetKeyCommand({ KvsARN: kvsArn, Key: 'status' }));
    const value = res.Value || 'unknown';
    kvsStatusCache = {
      kvsArn,
      value,
      expiresAt: Date.now() + STATUS_CACHE_TTL_MS,
    };
    return value;
  } catch (err) {
    console.error('getKvsStatus failed to get status key:', err);
    return 'stopped';
  }
}
```

The cache is also invalidated/updated immediately inside `updateKvsKey()`, `StartInstancesCommand`, and `RebootInstancesCommand` so state transitions aren't delayed.

2. **Bounded, visibility-aware polling in the browser (`lib/lambda/wakeup-page.ts`):**
   - Increased `POLL_INTERVAL_MS` from `2000` to `5000`
   - Paused polling whenever `document.hidden` is true (`visibilitychange` listener)
   - Added `MAX_POLL_DURATION_MS = 15 * 60 * 1000` (15 minutes) to stop polling and display a manual *"Check again"* button if the instance hasn't come up

---

## Takeaway

CloudFront Functions 2.0 + CloudFront KeyValueStore + `cf.updateRequestOrigin` is a clean, `$0/month` way to route traffic to ephemeral EC2 instances without an ALB or Elastic IP—just remember that **edge `kvs.get()` and Lambda SDK `GetKeyCommand` have completely different pricing**, and never let a browser poll an uncached `GetKeyCommand` endpoint indefinitely.

Full CDK v2 source: https://github.com/plthomasva/paperless-ngx-on-demand
```

---

## 2. `r/aws` — Standalone Technical Text Post

> **Why a text post?** `r/aws` moderators and community norms discourage bare external blog link drops (often auto-removed or downvoted as blog spam). Post the full technical summary below as a text post, and spot-check `https://www.reddit.com/r/aws/` sidebar rules and flair before submitting.

### Title

```text
Using CloudFront KeyValueStore + Functions 2.0 to route traffic to ephemeral EC2 IPs ($0/idle, and a $14.56 GetKey pitfall)
```

### Body

I wanted to run a stateful Docker workload (Paperless-NGX) on a single `t4g.medium` Graviton instance that stops to `$0/hr` when idle and wakes on demand—without paying for an ALB (~$16+/mo), Elastic IP, or NAT Gateway ($32.85/mo).

The solution that worked well in AWS CDK v2 is using **CloudFront + CloudFront Function (`JS_2_0`) + CloudFront KeyValueStore (KVS)** as a dynamic origin switch:

1. **Cold path:** The CloudFront distribution's default origin is a Lambda Function URL serving a ~50ms wake-up splash page (`/__wakeup*` also routes straight to Lambda). Crawlers and `.php`/`.env`/`/wp-login` probes are rejected in Lambda without calling `StartInstances`.
2. **Warm path:** On `VIEWER_REQUEST`, the CloudFront Function reads `status` and `originDomain` from `cf.kvs()`. When `status === 'running'`, it calls `cf.updateRequestOrigin({ domainName, customOriginConfig: { port: 8000, protocol: 'http', sslProtocols: ['TLSv1.2'] } })` to forward traffic to the EC2 instance's Nginx proxy.
3. **IPv4 gotcha:** `cf.updateRequestOrigin` strictly rejects raw IPv4 addresses. Both the CF Function (`lib/constructs/edge-router.ts`) and EC2 boot script (`runtime/boot-sync.sh`) convert raw IPv4s to `ec2-<dashed-ip>.compute-1.amazonaws.com` (or the regional equivalent).
4. **Syncing KVS:** `boot-sync.sh` writes `originDomain` and `status='running'` via `aws cloudfront-keyvaluestore put-key --region us-east-1` after local healthchecks pass. An idle watchdog (`runtime/watchdog.sh`) flips `status='stopped'` before `shutdown -h now`, and an EventBridge rule on `EC2 Instance State-change Notification` (`stopping`/`stopped`/`shutting-down`) resets KVS if the instance stops unexpectedly.

**The $14.56 billing pitfall (Issue #33):**
CloudFront Function `kvs.get()` reads at the edge are practically free, **but** calling `GetKeyCommand` from Lambda via `@aws-sdk/client-cloudfront-keyvaluestore` bills **$0.001 per `GetKey` operation**. I left a wake-up tab open overnight during a deploy while EC2 stayed stopped; 2-second polling racked up 14,558 `GetKey` calls = **$14.56**.

Fixed in v1.2.5 by adding a 15-second module-scope TTL cache (`STATUS_CACHE_TTL_MS = 15 * 1000`) in Lambda (`lib/lambda/wakeup-handler.ts`), bumping client polling to 5s, pausing on `document.hidden`, and capping polling at 15 minutes with a manual retry button.

Full CDK code if anyone wants to inspect or reuse the pattern: https://github.com/plthomasva/paperless-ngx-on-demand
