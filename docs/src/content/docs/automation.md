---
title: Automated CI/CD & Releases
description: Automated release management, quality gates, and zero-downtime AWS OIDC deployments.
---

Paperless-NGX On-Demand implements enterprise-grade CI/CD and release automation matching the conventions of the Wishboard open-source ecosystem.

---

## 1. Automated Continuous Integration (CI)

Every commit and pull request triggers `.github/workflows/node.js.yml`:
- **Code Quality & Formatting**: ESLint (TypeScript rules) and Prettier style checks.
- **Secret Scanning**: Gitleaks scanner running against commit deltas to prevent credential leakage.
- **Multi-Node Matrix**: Vitest unit and architectural tests running across Node 22.x and Node 24.x.
- **SonarCloud Quality Gate**: Analyzes code quality, maintainability, reliability, and security ratings, enforcing an 80% coverage threshold on all new code.
- **Stryker Mutation Testing**: Scheduled nightly runs in `.github/workflows/stryker.yml` measure test effectiveness against subtle mutation bugs.

---

## 2. Automated Release Management (Release Please)

Releases are managed entirely through [Google Release Please](https://github.com/googleapis/release-please):
1. Merging commits with Conventional Commit prefixes (`feat:`, `fix:`, `perf:`) triggers the Release Please action on `main`.
2. Release Please automatically maintains an open Release PR that bumps `package.json` according to SemVer rules and updates `CHANGELOG.md`.
3. When the repository owner merges the Release PR, Release Please creates the official Git tag and GitHub Release.

---

## 3. Automated AWS OIDC Deployment

Once a release is tagged on `main`, the deployment job in `.github/workflows/release.yml` executes automatically:

```
┌─────────────────────────────────┐
│ Merge Release Please PR on main │
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────┐
│ GitHub Actions: Release Created │
└────────────────┬────────────────┘
                 ▼
┌────────────────────────────────────────────────────────┐
│ Environment: production (Restricted to main branch)    │
│  • Requests short-lived token from GitHub OIDC provider│
└────────────────┬───────────────────────────────────────┘
                 ▼
┌────────────────────────────────────────────────────────┐
│ AWS STS: AssumeRoleWithWebIdentity                     │
│  • Validates repo:plthomasva/paperless-ngx-on-demand   │
│  • Validates environment:production                    │
│  • Assumes paperless-github-deployer-role              │
└────────────────┬───────────────────────────────────────┘
                 ▼
┌────────────────────────────────────────────────────────┐
│ AWS CDK Deploy (Zero-Downtime Update)                  │
│  • CloudFormation updates stack without interruption   │
└────────────────────────────────────────────────────────┘
```

### Security & Fork Isolation
- **Fork Safety**: External pull requests from forks cannot access repository secrets or assume AWS IAM roles.
- **Environment Protection**: The deployment step binds to the `production` environment, configured with a deployment branch policy that permits only the protected `main` branch.
- **Hardened AWS Trust Policy**: AWS STS enforces that the OIDC subject (`sub`) matches `repo:plthomasva/paperless-ngx-on-demand:environment:production`, preventing rogue branches or actions from deploying.

