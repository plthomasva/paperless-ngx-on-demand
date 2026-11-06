---
title: Quickstart & Installation
description: Step-by-step setup wizard and automated deployment.
---

Deploying Paperless-NGX On-Demand requires just a few commands using the built-in TypeScript interactive wizard and AWS CDK.

---

## 1. Clone & Install Dependencies

Ensure you have **Node.js 22 or 24** installed:

```bash
git clone https://github.com/plthomasva/paperless-ngx-on-demand.git
cd paperless-ngx-on-demand
npm install
```

---

## 2. Run the Interactive Setup Wizard

Run the interactive setup tool to configure your deployment:

```bash
npm run setup
```

The wizard prompts you for:
- **AWS Profile**: Named profile from `~/.aws/config` (defaults to `paperless` or `default`).
- **AWS Region**: Defaults to `us-east-1`.
- **Custom Domain Name**: e.g., `pod.example.com`.
- **ACM Certificate ARN**: The ARN created in `us-east-1` from the [Prerequisites guide](/paperless-ngx-on-demand/prerequisites/).
- **S3 Bucket Configuration**: Create a new namespaced bucket (e.g., `paperless-ngx-storage-<random>`) or attach an existing S3 bucket.
- **Admin Username & Email**: Default admin credentials.

The configuration is saved to the local `.gitignored` file `paperless.config.json`.

---

## 3. Bootstrap AWS CDK

If you have never deployed AWS CDK apps in your target account and region, run:

```bash
npm run bootstrap
```

This provisions the modern AWS CDK Toolkit stack containing the S3 asset staging bucket, ECR repository, and CloudFormation execution roles.

---

## 4. Deploy Infrastructure

Deploy the complete CloudFormation stack:

```bash
npm run deploy
```

AWS CDK will synthesize the CloudFormation template and provision:
1. VPC with public subnets, internet gateway, and free S3 Gateway VPC Endpoint.
2. S3 Storage & Inbox Bucket with server-side encryption and public access block.
3. EC2 Graviton ARM64 (`t4g.medium`) with encrypted 10 GB gp3 root EBS.
4. Wakeup Lambda function with Function URL.
5. CloudFront distribution with TLS 1.3, KeyValueStore, and edge routing function.

Upon completion, CloudFormation outputs your live URLs:
```text
Outputs:
PaperlessOnDemandStack.PaperlessUrl = https://pod.example.com
PaperlessOnDemandStack.CloudFrontUrl = https://d12345678abcdef.cloudfront.net
PaperlessOnDemandStack.S3StorageBucket = paperless-ngx-storage-1234567890
PaperlessOnDemandStack.InstanceId = i-0123456789abcdef0
```

---

## 5. First Login & Password Retrieval

On first boot, the initialization script generates a strong random password for your admin account and stores it securely in AWS Systems Manager (SSM) Parameter Store:

Retrieve the initial password via the AWS CLI:
```bash
aws ssm get-parameter \
  --name "/paperless/admin-password" \
  --with-decryption \
  --query "Parameter.Value" \
  --output text \
  --profile paperless
```

Visit your domain (`https://pod.example.com`) and log in!

---

## 6. Enable Automated GitHub Actions Redeployments (Optional)

To enable automatic zero-downtime redeployments whenever you push a new release to GitHub:

```bash
npm run setup:oidc
```

This provisions a least-privilege AWS IAM OIDC deployment role tied directly to your GitHub repository and environment. Add the generated Role ARN as `AWS_ROLE_TO_ASSUME` in your GitHub repository secrets.
