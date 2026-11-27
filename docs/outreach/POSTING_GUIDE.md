# Outreach Posting Guide & Compliance Checklist

## Why These Are Ready-to-Post Drafts

In this execution environment, **only the GitHub CLI (`gh`, authenticated as `plthomasva`) is available**. There are no API tokens, CLIs (`praw`, etc.), or authenticated browser cookies/sessions for **Reddit**, **Hacker News**, **dev.to**, or **Hashnode**.

To avoid violating platform automation/spam rules and to keep you in control of your accounts, all external posts have been drafted in `docs/outreach/` and verified against the live codebase (`v1.2.5`, commit `731cb58`) and each platform's current policies.

---

## Inventory of Outreach Files

| File | Target Platforms | Purpose |
| :--- | :--- | :--- |
| `docs/outreach/reddit-deep-dive.md` | `r/Paperlessngx`, `r/selfhosted` | Architecture case study, $2.04/mo cost breakdown, $14.56 Issue #33 post-mortem, New Project Megathread entry, and AI-Compliance bot reply |
| `docs/outreach/show-hn.md` | Hacker News (`Show HN`) | `Show HN` submission fields, submission checklist, HN no-AI-comments policy warning, and verified talking points |
| `docs/outreach/aws-kvs-article.md` | `dev.to`, Hashnode, `r/aws` | Technical article on CloudFront KVS + ephemeral EC2 IPs + Issue #33 `GetKey` pitfall, plus standalone `r/aws` text post |
| `docs/outreach/organic-qa-answers.md` | GitHub Discussions (`#762`), Q&A reference | Organic technical answers for AWS/S3/Fargate/Lambda questions (see Worker M3 output) |

---

## Step-by-Step Posting Checklist by Platform

### 1. `r/Paperlessngx` (`docs/outreach/reddit-deep-dive.md` §1)
- [ ] Open `https://www.reddit.com/r/Paperlessngx/` in your browser.
- [ ] **Spot-check sidebar rules and post flairs** before submitting (select the most relevant flair, e.g., `Guide` / `Discussion` / `Showcase`).
- [ ] Copy-paste the title and body from `docs/outreach/reddit-deep-dive.md` §1.
- [ ] Stick around to answer questions about `mount-s3`, SQLite backups, or CloudFront KVS.

### 2. `r/selfhosted` (`docs/outreach/reddit-deep-dive.md` §2–§4)
- [ ] **Respect the 3-month rule:** `paperless-ngx-on-demand` was announced Nov 7, 2026 (<3 months old).
  - If posting as a **new project showcase**, post **§3** inside the current week's **New Project Megathread** (posted every Friday; you can comment any day of the week).
  - If posting as a **standalone thread**, use **§2**, which is strictly framed as an engineering case study / bug post-mortem rather than a product pitch.
- [ ] **Reply to the AI-Compliance Auto Comment Bot:** Immediately after submitting a standalone post, AutoModerator will auto-remove it and leave a comment asking how AI was involved. Reply using **§4** (adjusted if needed) so the post is automatically approved.

### 3. Hacker News `Show HN` (`docs/outreach/show-hn.md`)
- [ ] Verify you are logged into an **established** HN account (brand-new accounts cannot post `Show HN`).
- [ ] Submit at `https://news.ycombinator.com/submit` using the exact Title and URL in `docs/outreach/show-hn.md` §1.
- [ ] **NO AI-GENERATED OR AI-EDITED COMMENTS:** Per [`https://news.ycombinator.com/newsguidelines.html#generated`](https://news.ycombinator.com/newsguidelines.html#generated), HN auto-kills comments classified as AI-generated or AI-edited. Write any maker's comment and all replies **entirely in your own words** (use `show-hn.md` §4 only as a factual reference).
- [ ] Do not ask anyone to upvote or comment.

### 4. `dev.to` & Hashnode (`docs/outreach/aws-kvs-article.md` §1)
- [ ] Decide which platform is your **primary** publication (`dev.to` or Hashnode) and publish there first.
- [ ] **On `dev.to`:**
  - Keep `#ABotWroteThis` in the tags (or keep the inline AI-assistance disclosure) per [`https://dev.to/devteam/guidelines-for-ai-assisted-articles-on-dev-17n6`](https://dev.to/devteam/guidelines-for-ai-assisted-articles-on-dev-17n6).
  - If Hashnode was published first, uncomment and set `canonical_url:` in the YAML frontmatter to the Hashnode article URL.
  - Do not use bots or AI to generate comments on `dev.to`.
- [ ] **On Hashnode:**
  - If `dev.to` was published first, open Draft Settings and set **Original Article URL** (canonical URL) to the `dev.to` article URL.
  - Keep the inline AI-assistance disclosure so readers know the code and incident were human-verified.

### 5. `r/aws` (`docs/outreach/aws-kvs-article.md` §2)
- [ ] Open `https://www.reddit.com/r/aws/` in your browser and **spot-check sidebar rules and flair**.
- [ ] Submit as a **Text Post** using `docs/outreach/aws-kvs-article.md` §2 (do **not** submit a bare link drop to `dev.to`/Hashnode, as `r/aws` filters/downvotes bare blog links).
