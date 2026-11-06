---
title: External Prerequisites
description: What needs to be configured outside this repository before deployment.
---

Paperless-NGX On-Demand automates nearly all cloud infrastructure (VPC, Security Groups, IAM Roles, S3 Buckets, EC2 instances, CloudFront Distributions, KeyValueStore, Lambda functions, and CloudWatch metrics). 

However, **four foundational prerequisites** must be set up manually in your external accounts:

---

## 1. AWS Account Setup

You will need an active AWS account with billing enabled.
- If you are opening a new AWS account, you qualify for the **AWS Free Tier** for your first 12 months (750 hours of `t4g.small` free, 5 GB S3 standard, 1 TB CloudFront transfer).
- Recommended: Create a dedicated IAM user or Identity Center (SSO) administrator profile with permissions to run CloudFormation and AWS CDK.
- Ensure your local environment has the AWS CLI configured:
  ```bash
  aws configure --profile paperless
  ```

---

## 2. Domain Registration

You need a domain name (or a dedicated subdomain, such as `pod.yourdomain.com` or `paperless.yourdomain.com`).
- You can register a domain via Amazon Route 53 or any external registrar (e.g. Cloudflare, Namecheap, Porkbun, Google Domains/Squarespace).
- Domain registration typically costs between \$8 and \$14 per year depending on the TLD (`.com`, `.net`, `.org`).

---

## 3. SSL/TLS Certificate (AWS Certificate Manager)

CloudFront distributions require TLS certificates to be issued in the **`us-east-1` (N. Virginia)** region, regardless of where your EC2 compute instance runs.

1. Navigate to the **AWS Certificate Manager (ACM)** console in `us-east-1`.
2. Click **Request a public certificate**.
3. Enter your fully qualified domain name (e.g., `pod.yourdomain.com` or `*.yourdomain.com`).
4. Select **DNS validation**.
5. Copy the generated `CNAME` name and value into your domain's DNS provider to complete validation.
6. Once validated, copy the **Certificate ARN** (e.g., `arn:aws:acm:us-east-1:123456789012:certificate/xxxx-xxxx-xxxx`). You will supply this ARN to the setup wizard.

---

## 4. DNS Routing (Route 53 or External DNS)

Once your CloudFront distribution is deployed, you will point your domain to the CloudFront distribution domain name (e.g., `d12345678abcdef.cloudfront.net`):

### Option A: Using Amazon Route 53 (Automated Alias)
If your domain is hosted in a Route 53 Hosted Zone, create an **A (Alias)** record:
- Record name: `pod` (or apex `@`)
- Record type: `A`
- Toggle **Alias** to ON.
- Choose **Alias to CloudFront distribution**.
- Select your CloudFront distribution from the list.

### Option B: Using an External DNS Provider (Cloudflare, Porkbun, Namecheap)
If using an external registrar or DNS provider:
- Record type: `CNAME`
- Host/Name: `pod`
- Target/Value: `<your-distribution-id>.cloudfront.net`
- Proxy status (Cloudflare): Set to **DNS Only** (gray cloud) to allow CloudFront to terminate TLS directly.

