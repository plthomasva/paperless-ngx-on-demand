#!/usr/bin/env node
/**
 * Setup script for GitHub Actions OIDC deployment role in AWS IAM.
 * Configures the OIDC identity provider and least-privilege deployment role
 * capable of assuming CDK bootstrap roles for automated release deployments.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  IAMClient,
  CreateOpenIDConnectProviderCommand,
  GetOpenIDConnectProviderCommand,
  CreateRoleCommand,
  GetRoleCommand,
  UpdateAssumeRolePolicyCommand,
  PutRolePolicyCommand,
} from '@aws-sdk/client-iam';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'paperless.config.json');

async function main() {
  console.log('=== Paperless-NGX On-Demand: GitHub Actions OIDC Setup ===\n');

  let localConfig: Record<string, any> = {};
  if (fs.existsSync(configPath)) {
    try {
      localConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      // ignore
    }
  }

  const region = process.env.AWS_REGION || localConfig.region || 'us-east-1';
  const roleName = 'paperless-github-deployer-role';
  const repoName =
    process.env.GITHUB_REPOSITORY || localConfig.githubRepo || 'plthomasva/paperless-ngx-on-demand';

  const stsClient = new STSClient({ region });
  const identity = await stsClient.send(new GetCallerIdentityCommand({}));
  const accountId = identity.Account;

  console.log(`Configuring AWS Account: ${accountId}`);
  console.log(`Target Region: ${region}`);
  console.log(`GitHub Repository: ${repoName}\n`);

  const iamClient = new IAMClient({ region });
  const providerArn = `arn:aws:iam::${accountId}:oidc-provider/token.actions.githubusercontent.com`;

  // 1. Ensure OIDC Provider
  try {
    await iamClient.send(
      new GetOpenIDConnectProviderCommand({
        OpenIDConnectProviderArn: providerArn,
      })
    );
    console.log(`✓ GitHub OIDC provider already exists: ${providerArn}`);
  } catch (err: any) {
    if (err.name === 'NoSuchEntityException' || err.name === 'NoSuchEntity') {
      console.log('Creating GitHub OIDC identity provider...');
      await iamClient.send(
        new CreateOpenIDConnectProviderCommand({
          Url: 'https://token.actions.githubusercontent.com',
          ClientIDList: ['sts.amazonaws.com'],
          ThumbprintList: [
            '6938fd4d98bab03faadb97b34396831e3780aea1',
            '1c58a3a8518e8759bf075b76b750d4f2df264fcd',
          ],
        })
      );
      console.log(`✓ Created OIDC provider: ${providerArn}`);
    } else {
      throw err;
    }
  }

  // 2. Trust Policy restricted to protected environment and main/tags
  const trustPolicy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          Federated: providerArn,
        },
        Action: ['sts:AssumeRoleWithWebIdentity', 'sts:TagSession'],
        Condition: {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': [
              `repo:${repoName}:*`,
              `repo:${repoName.replace('/', '@*/')}@*:*`,
            ],
          },
        },
      },
    ],
  };

  // 3. Ensure Deployer Role
  let roleArn = `arn:aws:iam::${accountId}:role/${roleName}`;
  try {
    await iamClient.send(new GetRoleCommand({ RoleName: roleName }));
    console.log(`✓ IAM Role "${roleName}" already exists. Updating trust policy...`);
    await iamClient.send(
      new UpdateAssumeRolePolicyCommand({
        RoleName: roleName,
        PolicyDocument: JSON.stringify(trustPolicy, null, 2),
      })
    );
    console.log(`✓ Updated assume-role trust policy.`);
  } catch (err: any) {
    if (err.name === 'NoSuchEntityException' || err.name === 'NoSuchEntity') {
      console.log(`Creating IAM Role "${roleName}"...`);
      const res = await iamClient.send(
        new CreateRoleCommand({
          RoleName: roleName,
          AssumeRolePolicyDocument: JSON.stringify(trustPolicy, null, 2),
          Description:
            'Role assumed by GitHub Actions for automated deployment of Paperless-NGX On-Demand',
        })
      );
      roleArn = res.Role?.Arn || roleArn;
      console.log(`✓ Created IAM Role: ${roleArn}`);
    } else {
      throw err;
    }
  }

  // 4. Attach least-privilege CDK Deploy permissions
  const deployPolicy = {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'AssumeCdkBootstrapRoles',
        Effect: 'Allow',
        Action: ['sts:AssumeRole', 'sts:TagSession'],
        Resource: [`arn:aws:iam::${accountId}:role/cdk-hnb659fds-*-${accountId}-${region}`],
      },
      {
        Sid: 'StsIdentity',
        Effect: 'Allow',
        Action: ['sts:GetCallerIdentity'],
        Resource: '*',
      },
    ],
  };

  await iamClient.send(
    new PutRolePolicyCommand({
      RoleName: roleName,
      PolicyName: 'CdkDeployPolicy',
      PolicyDocument: JSON.stringify(deployPolicy, null, 2),
    })
  );
  console.log(`✓ Attached CdkDeployPolicy granting CDK bootstrap role assumption.`);

  console.log('\n=== OIDC Setup Complete ===');
  console.log(`Role ARN: ${roleArn}`);
  console.log('\nTo enable GitHub Actions automated deployment:');
  console.log(
    `1. Set repository secret "AWS_ROLE_TO_ASSUME" in GitHub Settings -> Secrets -> Actions to:`
  );
  console.log(`   ${roleArn}`);
  console.log(`2. Ensure repository variables are configured (AWS_REGION, DOMAIN_NAME, etc.)`);
}

main().catch((err) => {
  console.error('\nError setting up OIDC deployment role:', err);
  process.exit(1);
});
