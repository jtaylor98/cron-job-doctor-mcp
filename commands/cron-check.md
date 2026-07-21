---
description: Check all scheduled GitHub Actions workflows in a repo for problems
argument-hint: [owner/repo]
---

Call `compare_workflows_widget` for the repo `$1`, with `workflow_ids`
omitted so it compares every scheduled workflow found automatically.
Do not call `list_scheduled_workflows` or `diagnose_workflow` first --
`compare_workflows_widget` does that internally. Do not restate the
numbers the widget already shows; give at most a one-sentence summary of
which workflow(s), if any, need attention.
