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
    console.log('No local configuration found. Running setup wizard first...\n');
    const setupProc = spawn('npx', ['tsx', 'scripts/setup.ts'], {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true,
    });
    await new Promise((resolve, reject) => {
      setupProc.on('close', (code) =>
        code === 0 ? resolve(null) : reject(new Error(`Setup failed with code ${code}`))
      );
    });
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const profile = config.awsProfile || 'default';
  const region = config.region || 'us-east-1';

  console.log(
    `\nDeploying Paperless-NGX On-Demand using AWS profile "${profile}" in region "${region}"...`
  );

  const cdkArgs = ['cdk', 'deploy'];
  if (profile) {
    cdkArgs.push('--profile', profile);
  }

  const deployProc = spawn('npx', cdkArgs, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      AWS_PROFILE: profile,
      AWS_REGION: region,
      CDK_DEFAULT_REGION: region,
      CDK_DEFAULT_ACCOUNT: config.account,
    },
  });

  deployProc.on('close', (code) => {
    process.exit(code || 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
