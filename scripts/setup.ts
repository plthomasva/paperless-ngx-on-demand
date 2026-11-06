#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { fileURLToPath } from 'url';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'paperless.config.json');

// Existing config if present
let existingConfig: Record<string, any> = {};
if (fs.existsSync(configPath)) {
  try {
    existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    // Ignore unparseable existing config
  }
}

async function main() {
  const rl = readline.createInterface({ input, output });

  console.log('\n======================================================');
  console.log('   Paperless-NGX On-Demand Setup & Configuration');
  console.log('======================================================\n');
  console.log('This wizard will guide you through setting up your deployment.');
  console.log('Your choices will be saved to the local, .gitignored file:');
  console.log(`  ${configPath}\n`);

  async function prompt(question: string, defaultValue: string = ''): Promise<string> {
    const promptText = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    const answer = await rl.question(promptText);
    return answer.trim() || defaultValue;
  }

  // 1. AWS Profile & Region
  const defaultProfile = existingConfig.awsProfile || process.env.AWS_PROFILE || 'default';
  const awsProfile = await prompt('1. AWS CLI Profile name', defaultProfile);

  const defaultRegion = existingConfig.region || process.env.AWS_REGION || 'us-east-1';
  const region = await prompt(
    '2. AWS Region (CloudFront requires us-east-1 for ACM)',
    defaultRegion
  );

  // 2. Fetch Account ID
  let accountId = existingConfig.account || '';
  try {
    console.log(`\nVerifying AWS credentials for profile "${awsProfile}"...`);
    process.env.AWS_PROFILE = awsProfile;
    const sts = new STSClient({ region });
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    accountId = identity.Account || '';
    console.log(`✓ Connected to AWS Account ID: ${accountId}`);
  } catch (err: any) {
    console.warn(`! Note: Could not auto-detect Account ID via STS: ${err.message}`);
    accountId = await prompt('Enter your 12-digit AWS Account ID manually', accountId);
  }

  // 3. S3 Storage Configuration
  console.log('\n--- S3 Storage Configuration ---');
  console.log('Options:');
  console.log('  [A] Fresh Deployment: Auto-generate a conflict-free, namespaced bucket:');
  console.log(`      paperless-storage-${accountId || '<account>'}-${region}`);
  console.log('  [B] Existing Bucket: Re-use an existing Paperless S3 storage bucket.');

  const useExisting = await prompt(
    'Do you want to re-use an existing S3 bucket? (y/N)',
    existingConfig.existingBucketName ? 'y' : 'N'
  );

  let existingBucketName = '';
  let mediaSubpath = 'media';
  if (useExisting.toLowerCase().startsWith('y')) {
    existingBucketName = await prompt(
      'Existing S3 Bucket Name',
      existingConfig.existingBucketName || ''
    );
    mediaSubpath = await prompt(
      'Media prefix/subpath inside bucket (e.g. "media" or "" for root)',
      existingConfig.mediaSubpath || 'media'
    );
  } else {
    console.log(`✓ Will create fresh unified bucket: paperless-storage-${accountId}-${region}`);
  }

  // 4. Custom Domain & TLS Certificate
  console.log('\n--- Domain & TLS Configuration ---');
  const domainName = await prompt(
    'Custom domain (e.g. paperless.example.com, or leave empty for CloudFront URL)',
    existingConfig.domainName || ''
  );

  let certificateArn = '';
  if (domainName) {
    console.log('CloudFront requires an ACM certificate in us-east-1 for custom domains.');
    certificateArn = await prompt(
      'ACM Certificate ARN in us-east-1 (or leave empty to let CDK request one with DNS validation)',
      existingConfig.certificateArn || ''
    );
  }

  // 5. Paperless Initial Admin Credentials
  console.log('\n--- Paperless Initial Admin Credentials ---');
  const adminUser = await prompt('Paperless admin username', existingConfig.adminUser || 'admin');
  const adminEmail = await prompt(
    'Paperless admin email',
    existingConfig.adminEmail || 'admin@example.com'
  );

  rl.close();

  const newConfig = {
    awsProfile,
    region,
    account: accountId,
    existingBucketName,
    mediaSubpath,
    domainName,
    certificateArn,
    adminUser,
    adminEmail,
  };

  fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2) + '\n');

  console.log('\n======================================================');
  console.log('✓ Configuration successfully saved to:');
  console.log(`  ${configPath}`);
  console.log('======================================================\n');
  console.log('You can now deploy with a simple single command:');
  console.log('  npm run deploy\n');
}

main().catch((err) => {
  console.error('\nSetup error:', err);
  process.exit(1);
});
