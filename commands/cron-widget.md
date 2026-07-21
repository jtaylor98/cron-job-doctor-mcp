---
description: Diagnose one scheduled workflow as an interactive widget
argument-hint: [owner/repo] [workflow name or ID]
---

Diagnose the workflow `$2` in the repo `$1`.

1. If `$2` looks like a name rather than a numeric ID, call
   `list_scheduled_workflows` for `$1` first to resolve it to a
   `workflow_id`.
2. Call `diagnose_workflow_widget` with that `workflow_id`. Do not call
   the plain-text `diagnose_workflow` tool for this command under any
   circumstances -- this command exists specifically to force the widget.
3. Summarize in at most one sentence; don't restate what the widget
   already shows.
