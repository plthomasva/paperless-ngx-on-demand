#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'paperless.config.json');

async function main() {
  if (!fs.existsSync(configPath)) {
    console.error('Error: paperless.config.json not found. Please run "npm run setup" first.');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const profile = config.awsProfile || 'default';
  const region = config.region || 'us-east-1';
  const account = config.account;

  if (!account) {
    console.error('Error: "account" is required in paperless.config.json for bootstrapping.');
    process.exit(1);
  }

  console.log(`Bootstrapping CDK in account ${account} (${region}) using profile "${profile}"...`);

  const args = ['cdk', 'bootstrap'];
  if (profile) {
    args.push('--profile', profile);
  }
  args.push(`aws://${account}/${region}`);

  const proc = spawn('npx', args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      AWS_PROFILE: profile,
      AWS_REGION: region,
    },
  });

  proc.on('close', (code) => {
    process.exit(code || 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

