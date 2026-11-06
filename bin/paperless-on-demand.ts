#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as cdk from 'aws-cdk-lib';
import { PaperlessOnDemandStack } from '../lib/paperless-on-demand-stack.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load optional local configuration from .gitignored paperless.config.json
let localConfig: Record<string, any> = {};
const configPath = path.join(rootDir, 'paperless.config.json');
if (fs.existsSync(configPath)) {
  try {
    localConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (localConfig.awsProfile && !process.env.AWS_PROFILE) {
      process.env.AWS_PROFILE = localConfig.awsProfile;
    }
  } catch (err) {
    console.warn('Warning: Could not parse paperless.config.json:', err);
  }
}

const app = new cdk.App();

// Priority: CDK Context (--context) > localConfig (paperless.config.json) > Defaults
const existingBucketName =
  app.node.tryGetContext('existingBucketName') ||
  app.node.tryGetContext('existingMediaBucketName') ||
  localConfig.existingBucketName ||
  localConfig.existingMediaBucketName;

const mediaSubpath =
  app.node.tryGetContext('mediaSubpath') || localConfig.mediaSubpath || 'media';

const domainName =
  app.node.tryGetContext('domainName') || localConfig.domainName;

const certificateArn =
  app.node.tryGetContext('certificateArn') || localConfig.certificateArn;

const adminUser =
  app.node.tryGetContext('adminUser') || localConfig.adminUser || 'admin';

const adminEmail =
  app.node.tryGetContext('adminEmail') || localConfig.adminEmail || 'admin@example.com';

const cloudfrontPrefixListId =
  app.node.tryGetContext('cloudfrontPrefixListId') || localConfig.cloudfrontPrefixListId;

const targetRegion =
  app.node.tryGetContext('region') ||
  localConfig.region ||
  process.env.CDK_DEFAULT_REGION ||
  process.env.AWS_REGION ||
  'us-east-1';

const targetAccount =
  app.node.tryGetContext('account') ||
  localConfig.account ||
  process.env.CDK_DEFAULT_ACCOUNT;

new PaperlessOnDemandStack(app, 'PaperlessOnDemandStack', {
  existingBucketName,
  mediaSubpath,
  domainName,
  certificateArn,
  adminUser,
  adminEmail,
  cloudfrontPrefixListId,
  env: {
    account: targetAccount,
    region: targetRegion,
  },
  description: 'On-demand scale-to-zero Paperless-NGX architecture with CloudFront KVS dynamic routing',
});

app.synth();
