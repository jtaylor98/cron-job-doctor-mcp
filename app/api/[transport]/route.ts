import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  listWorkflows,
  isScheduledWorkflow,
  getWorkflowRuns,
  detectAnomalies,
  summarizeRuns,
  rerunWorkflow,
  setWorkflowEnabled,
} from "@/lib/github";
import { registerWidgets } from "@/lib/widgets";
import { recordDiagnosis, getDiagnosisHistory, diffAgainstPrevious } from "@/lib/history";

// This route calls GitHub's API per-request and must never be statically prerendered.
export const dynamic = "force-dynamic";

const repoArgs = {
  owner: z.string().describe("GitHub repo owner, e.g. 'jtaylor98'"),
  repo: z.string().describe("GitHub repo name, e.g. 'my-project'"),
};

const handler = createMcpHandler(async (server) => {
  server.tool(
    "list_scheduled_workflows",
    "List GitHub Actions workflows in a repo that run on a cron schedule",
    repoArgs,
    async ({ owner, repo }) => {
      const workflows = await listWorkflows(owner, repo);
      const scheduled = [];
      for (const wf of workflows) {
        if (await isScheduledWorkflow(owner, repo, wf.path)) {
          scheduled.push(wf);
        }
      }
      return {
        content: [{ type: "text", text: JSON.stringify(scheduled, null, 2) }],
      };
    }
  );

  server.tool(
    "get_workflow_runs",
    "Get recent schedule-triggered run history for one workflow",
    {
      ...repoArgs,
      workflow_id: z.number().describe("Workflow ID from list_scheduled_workflows"),
      limit: z.number().optional().describe("How many recent runs to fetch (default 20)"),
    },
    async ({ owner, repo, workflow_id, limit }) => {
      const runs = await getWorkflowRuns(owner, repo, workflow_id, limit ?? 20);
      return {
        content: [{ type: "text", text: JSON.stringify(runs, null, 2) }],
      };
    }
  );

  server.tool(
    "diagnose_workflow",
    "Fetch a workflow's run history and flag anomalies: stuck schedules, " +
      "retry storms, duration creep, a failed most-recent run, and an " +
      "elevated failure rate across recent runs (even if the latest one succeeded)",
    {
      ...repoArgs,
      workflow_id: z.number().describe("Workflow ID from list_scheduled_workflows"),
    },
    async ({ owner, repo, workflow_id }) => {
      const runs = await getWorkflowRuns(owner, repo, workflow_id, 20);
      const anomalies = detectAnomalies(runs);
      const stats = summarizeRuns(runs);

      // Look up the previous diagnosis before recording this one, so we can
      // tell the difference between a brand-new problem and one that's
      // already been showing up in past checks.
      const [previous] = await getDiagnosisHistory(owner, repo, workflow_id, 1);
      const { newTypes, recurringTypes } = diffAgainstPrevious(
        anomalies.map((a) => a.type),
        previous ?? null
      );
      await recordDiagnosis(owner, repo, workflow_id, stats, anomalies);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                workflow_id,
                runs_analyzed: runs.length,
                latest_run: runs[0] ?? null,
                anomalies,
                new_since_last_check: newTypes,
                recurring_from_last_check: recurringTypes,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "get_diagnosis_history",
    "Get past diagnosis snapshots for a workflow, showing how its failure " +
      "rate, average duration, and flagged anomalies have changed over " +
      "time. Use this when the user asks whether a problem is new, how " +
      "long something has been going on, or wants a trend rather than a " +
      "single point-in-time check.",
    {
      ...repoArgs,
      workflow_id: z.number().describe("Workflow ID from list_scheduled_workflows"),
      limit: z.number().optional().describe("How many past snapshots to return (default 20)"),
    },
    async ({ owner, repo, workflow_id, limit }) => {
      const history = await getDiagnosisHistory(owner, repo, workflow_id, limit ?? 20);
      return {
        content: [
          {
            type: "text",
            text: history.length === 0
              ? "No history recorded yet for this workflow -- history builds up each time diagnose_workflow runs."
              : JSON.stringify(history, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "rerun_workflow",
    "WRITE ACTION -- re-runs a specific workflow run on GitHub. This has a " +
      "real side effect (consumes GitHub Actions minutes, may trigger real " +
      "deployments/notifications/side effects the workflow itself performs). " +
      "Only call this after the user has explicitly confirmed they want this " +
      "specific run re-run -- never call it automatically as part of a " +
      "diagnosis. Defaults to re-running only the failed jobs within the run.",
    {
      ...repoArgs,
      run_id: z.number().describe("The specific run ID to re-run (not the workflow ID)"),
      failed_jobs_only: z
        .boolean()
        .optional()
        .describe("If true (default), only re-run failed jobs. If false, re-run the entire run from scratch."),
    },
    async ({ owner, repo, run_id, failed_jobs_only }) => {
      const result = await rerunWorkflow(owner, repo, run_id, failed_jobs_only ?? true);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "set_workflow_enabled",
    "WRITE ACTION -- enables or disables a workflow's schedule going forward " +
      "on GitHub. Disabling stops all future scheduled and manual runs until " +
      "re-enabled. Only call this after the user has explicitly confirmed " +
      "which workflow and which direction (enable/disable) -- never call it " +
      "automatically as part of a diagnosis, even if a workflow looks stuck " +
      "or broken.",
    {
      ...repoArgs,
      workflow_id: z.number().describe("Workflow ID from list_scheduled_workflows"),
      enabled: z.boolean().describe("true to enable the workflow, false to disable it"),
    },
    async ({ owner, repo, workflow_id, enabled }) => {
      const result = await setWorkflowEnabled(owner, repo, workflow_id, enabled);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // --- MCP Apps: diagnosis widget --------------------------------------
  registerWidgets(server);
},
{
  // Optional server options (capabilities, etc.) -- none needed here.
},
{
  basePath: "/api",
  verboseLogs: true,
});

export { handler as GET, handler as POST, handler as DELETE };
