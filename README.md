# Cron Job Doctor MCP

A remote MCP server that diagnoses scheduled GitHub Actions workflows:
finds jobs that have gone silently stuck, are retrying in a loop, are
taking progressively longer to run, or just failed on their last run.

Tools exposed:
- `list_scheduled_workflows` — find every workflow in a repo with a `schedule:` trigger
- `get_workflow_runs` — raw run history for one workflow
- `diagnose_workflow` — run history + anomaly flags (stuck / retry storm / duration creep / recent failure)

## 1. Prerequisites

- A GitHub account with at least one repo that has a scheduled workflow
- A fine-grained [Personal Access Token](https://github.com/settings/personal-access-tokens/new)
  scoped to the repo(s) you want to check, with **read-only** access to:
  - Actions
  - Contents
  - Metadata
- A [Vercel](https://vercel.com) account

## 2. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin git@github.com:<you>/cron-job-doctor-mcp.git
git push -u origin main
```

## 3. Import into Vercel

1. Go to vercel.com/new → **Import Git Repository** → select this repo
   (install the Vercel GitHub App first if you haven't already)
2. In **Environment Variables**, add `GITHUB_TOKEN` with your PAT
3. Click Deploy

Every future `git push` to `main` auto-deploys.

## 4. Connect it to Claude / Cowork

Add a custom connector pointing at:

```
https://<your-vercel-domain>/api/mcp
```

Then try something like: *"Check my repo `me/my-project` for any cron jobs
that need attention."*

## Local development

```bash
npm install
cp .env.example .env.local   # fill in GITHUB_TOKEN
npm run dev
```
