import { createMcpHandler } from "@vercel/mcp-adapter";
import { z } from "zod";
import {
  listWorkflows,
  isScheduledWorkflow,
  getWorkflowRuns,
  detectAnomalies,
} from "@/lib/github";

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
      "retry storms, duration creep, and recent failures",
    {
      ...repoArgs,
      workflow_id: z.number().describe("Workflow ID from list_scheduled_workflows"),
    },
    async ({ owner, repo, workflow_id }) => {
      const runs = await getWorkflowRuns(owner, repo, workflow_id, 20);
      const anomalies = detectAnomalies(runs);
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
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
},
{
  // Optional server options (capabilities, etc.) -- none needed here.
},
{
  basePath: "/api/mcp",
});

export { handler as GET, handler as POST, handler as DELETE };
