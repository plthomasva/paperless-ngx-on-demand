#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PaperlessOnDemandStack } from '../lib/paperless-on-demand-stack.js';

const app = new cdk.App();

const existingBucketName =
  app.node.tryGetContext('existingBucketName') ||
  app.node.tryGetContext('existingMediaBucketName');
const mediaSubpath = app.node.tryGetContext('mediaSubpath') || 'media';
const domainName = app.node.tryGetContext('domainName');
const adminUser = app.node.tryGetContext('adminUser') || 'admin';
const adminEmail = app.node.tryGetContext('adminEmail') || 'admin@example.com';
const cloudfrontPrefixListId = app.node.tryGetContext('cloudfrontPrefixListId');

new PaperlessOnDemandStack(app, 'PaperlessOnDemandStack', {
  existingBucketName,
  mediaSubpath,
  domainName,
  adminUser,
  adminEmail,
  cloudfrontPrefixListId,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'On-demand scale-to-zero Paperless-NGX architecture with CloudFront KVS dynamic routing',
});

app.synth();
