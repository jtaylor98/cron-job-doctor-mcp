---
description: How to diagnose GitHub Actions cron jobs using the cron-job-doctor connector
---

# Diagnosing scheduled GitHub Actions workflows

This skill applies whenever the user asks about the health of a scheduled
GitHub Actions workflow (a "cron job"), or asks to check, audit, or diagnose
their GitHub Actions.

## Standard workflow

1. Call `list_scheduled_workflows` first to find the workflow's ID. Don't
   guess or ask the user for the numeric ID -- they usually don't know it.
2. Call `diagnose_workflow` (not just `get_workflow_runs`) as the default
   check. It runs anomaly detection on top of the raw run history, which is
   almost always what the user actually wants to know.
3. Only call `get_workflow_runs` directly when the user explicitly wants raw
   run history, timestamps, or logs rather than a health assessment -- or as
   a follow-up after `diagnose_workflow` flags something, to look for a
   pattern (e.g. "do the failures cluster around a specific time?").

## Interpreting results

- **A clean "no anomalies detected" result only reflects the analyzed
  window** (the most recent ~20 runs). If the user seems surprised by a
  clean result, or asks "are you sure," mention this scope explicitly rather
  than stating it as an absolute guarantee.
- **`recent_failure` and `failure_rate` are different signals and can
  disagree.** A workflow can have a healthy, successful latest run while
  still showing a concerning failure rate over the full window (e.g. an
  intermittent problem that happened to not occur on the most recent run).
  When summarizing, report both signals rather than only the latest run's
  status.
- **`stuck` and `retry_storm` are about timing, not run content.** A
  workflow can be "stuck" even if every run in its history succeeded --
  the concern is that it stopped firing at all, not that it's failing.
- If multiple anomalies fire at once, report all of them rather than only
  the most severe one -- they often point to related root causes (e.g.
  `duration_creep` alongside `failure_rate` can both stem from the same
  underlying resource issue).

## What this connector cannot see

This connector only has visibility into workflows with a `schedule:`
trigger, and only for repos the configured `GITHUB_TOKEN` has read access
to. It cannot see workflow YAML logic beyond detecting the presence of a
`schedule:` key, and it does not have access to job logs beyond timestamps
and pass/fail status -- for line-by-line log content, direct the user to
the GitHub Actions UI.

## Remediation actions (rerun_workflow, set_workflow_enabled)

These two tools have real side effects on the user's GitHub repo -- they
are not diagnostic, they change state. Follow this rule without exception:

**Never call `rerun_workflow` or `set_workflow_enabled` as a follow-up to
a diagnosis without the user explicitly asking for that specific action.**
Finding an anomaly is not permission to fix it. If a diagnosis surfaces a
problem, describe it and suggest the fix as an option -- then wait for the
user to say something like "yes, rerun it" or "disable that workflow"
before calling either tool.

When the user does confirm, restate exactly what you're about to do
(which repo, which workflow or run ID, which direction) before calling the
tool, since these IDs are easy to mix up between a workflow ID and a run
ID -- they are different numbers for the same workflow.

## Presenting results: which tool to use

Default to plain text (`diagnose_workflow`, `get_workflow_runs`,
`compare_workflows_widget`'s underlying data via individual
`diagnose_workflow` calls) for ordinary status questions, even simply
phrased ones like "check my cron jobs" or "how's X doing". Only use a
widget or artifact when the user's request contains an explicit visual
signal -- words like "show me", "visualize", "widget", "dashboard",
"chart", "graph", or "artifact".

When there is such an explicit signal:

- **About one specific workflow** -- call `diagnose_workflow_widget`. It
  shows a run-duration bar chart (hover for details, click a bar to ask a
  follow-up about that specific run) plus anomaly cards.

- **About multiple workflows, or a comparison** -- first attempt to build
  a live React/HTML Artifact that connects to the cron-job-doctor
  connector for real-time data. Pull the workflow list and stats through
  the connector's tools to drive the artifact.

  **If the artifact cannot successfully load live data from the
  connector** (e.g. it renders but the data never populates, or it
  errors trying to reach the connector), don't leave the user with a
  broken artifact -- fall back to calling `compare_workflows_widget`
  directly instead, which is a tested, reliably-working inline widget
  for the same comparison. Say briefly that the live artifact didn't
  load and you're showing the comparison a different way.

If the user wants a guaranteed widget regardless of phrasing, they can
use the `/cron-widget [owner/repo] [workflow]` or `/cron-check
[owner/repo]` slash commands, which always call the widget tools
directly without relying on this judgment call.

Never call `rerun_workflow` or `set_workflow_enabled` from inside a widget
or artifact without a separate, explicit user confirmation step -- the
same confirm-before-acting rule from the remediation section above
applies inside widgets and artifacts, not just in chat. Nothing built so
far has a button wired to a remediation action, so this only applies if
one is added later.

