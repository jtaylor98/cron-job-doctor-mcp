# Cron Job Doctor MCP

A remote MCP server that diagnoses scheduled GitHub Actions workflows:
finds jobs that have gone silently stuck, are retrying in a loop, are
taking progressively longer to run, or just failed on their last run --
and can rerun a specific run or enable/disable a workflow when asked.

Tools exposed:
- `list_scheduled_workflows` — find every workflow in a repo with a `schedule:` trigger
- `get_workflow_runs` — raw run history for one workflow
- `diagnose_workflow` — run history + anomaly flags (stuck / retry storm / duration creep / recent failure / failure rate), and records a snapshot to history
- `get_diagnosis_history` — past diagnosis snapshots for a workflow, so you can see trends over time rather than a single point-in-time check
- `rerun_workflow` — **write action**: re-runs a specific run (defaults to failed jobs only)
- `set_workflow_enabled` — **write action**: enables or disables a workflow's schedule
- `diagnose_workflow_widget` / `compare_workflows_widget` — interactive widget versions

## 1. Prerequisites

- A GitHub account with at least one repo that has a scheduled workflow
- A fine-grained [Personal Access Token](https://github.com/settings/personal-access-tokens/new)
  scoped to the repo(s) you want to check, with:
  - **Actions: Read and write** (read for diagnostics, write for rerun/enable/disable)
  - **Contents: Read and write** (read for the schedule check, write for diagnosis history storage)
  - **Metadata: Read-only**
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

## 4. Diagnosis history storage

`get_diagnosis_history` and the new-vs-recurring-anomaly diffing store
past snapshots as a markdown file (`.cron-job-doctor/history/<workflow_id>.md`,
containing a fenced JSON block) committed to a dedicated
**`cron-job-doctor-history`** branch in whichever repo is being diagnosed
-- not `main`, and not this server's own repo -- so it doesn't clutter
the target repo's regular commit history. The branch is created
automatically on first use; no manual setup needed beyond the token scope
above.

Every future `git push` to `main` on this server's repo auto-deploys.

## 5. Connect it to Claude / Cowork

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
