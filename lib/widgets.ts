import { z } from "zod";
import { getWorkflowRuns, detectAnomalies, listWorkflows, isScheduledWorkflow, summarizeRuns } from "./github";
import { WIDGETS } from "../app/_widgets.js";

// Cron Job Doctor's widget tool + its ui:// resource. This is separate from the
// five existing plain-text tools in route.ts -- registering it doesn't change
// their behavior at all.

const APP_MIME = "text/html;profile=mcp-app";
const widgetUri = (name: string) => `ui://cron-job-doctor/${name}.html`;
const widgetHtml = (name: string) =>
  Buffer.from((WIDGETS as Record<string, string>)[name], "base64").toString("utf8");

export function registerWidgets(server: any) {
  server.registerTool(
    "diagnose_workflow_widget",
    {
      title: "Diagnose a workflow (interactive widget)",
      description:
        "Render a workflow's diagnosis as an interactive widget: a bar chart " +
        "of the last 20 runs (duration, colored by success/failure) plus any " +
        "flagged anomalies (stuck, retry storm, duration creep, recent " +
        "failure, failure rate). Use when the user wants to SEE the diagnosis " +
        "visually rather than read it as text. Pass owner, repo, and " +
        "workflow_id. PRESENTATION: the widget shows the chart and anomalies " +
        "-- summarize briefly, don't restate them.",
      inputSchema: {
        owner: z.string().describe("GitHub repo owner"),
        repo: z.string().describe("GitHub repo name"),
        workflow_id: z.number().describe("Workflow ID from list_scheduled_workflows"),
      },
      _meta: { ui: { resourceUri: widgetUri("diagnosis") } },
    },
    async ({ owner, repo, workflow_id }: { owner: string; repo: string; workflow_id: number }) => {
      const runs = await getWorkflowRuns(owner, repo, workflow_id, 20);
      const anomalies = detectAnomalies(runs);
      const payload = {
        workflow_id,
        runs_analyzed: runs.length,
        latest_run: runs[0] ?? null,
        anomalies,
        runs,
      };
      return {
        content: [
          {
            type: "text",
            text: `Diagnosis widget rendered for workflow ${workflow_id}: ${anomalies.length} anomaly(ies) found across ${runs.length} runs. Don't restate them.`,
          },
        ],
        structuredContent: payload,
        _meta: { ui: { resourceUri: widgetUri("diagnosis") } },
      };
    }
  );

  server.registerResource(
    "Cron job doctor diagnosis widget",
    widgetUri("diagnosis"),
    { title: "Cron job doctor diagnosis", mimeType: APP_MIME },
    async () => ({
      contents: [{ uri: widgetUri("diagnosis"), mimeType: APP_MIME, text: widgetHtml("diagnosis") }],
    })
  );

  server.registerTool(
    "compare_workflows_widget",
    {
      title: "Compare scheduled workflows (interactive widget)",
      description:
        "Render a side-by-side comparison of multiple scheduled workflows in " +
        "a repo as an interactive widget: failure rate and average run " +
        "duration per workflow, with a health badge for each. Use when the " +
        "user wants to compare workflows or asks a broad status-check " +
        "question about a repo's scheduled jobs, rather than about one " +
        "specific workflow. If workflow_ids is omitted, compares every " +
        "scheduled workflow found in the repo. PRESENTATION: the widget " +
        "shows the comparison -- summarize briefly, don't restate every number.",
      inputSchema: {
        owner: z.string().describe("GitHub repo owner"),
        repo: z.string().describe("GitHub repo name"),
        workflow_ids: z
          .array(z.number())
          .optional()
          .describe("Specific workflow IDs to compare. Omit to compare all scheduled workflows in the repo."),
      },
      _meta: { ui: { resourceUri: widgetUri("compare") } },
    },
    async ({ owner, repo, workflow_ids }: { owner: string; repo: string; workflow_ids?: number[] }) => {
      let targets: { id: number; name: string }[];

      if (workflow_ids && workflow_ids.length > 0) {
        const all = await listWorkflows(owner, repo);
        targets = all
          .filter((wf) => workflow_ids.includes(wf.id))
          .map((wf) => ({ id: wf.id, name: wf.name }));
      } else {
        const all = await listWorkflows(owner, repo);
        targets = [];
        for (const wf of all) {
          if (await isScheduledWorkflow(owner, repo, wf.path)) {
            targets.push({ id: wf.id, name: wf.name });
          }
        }
      }

      const workflows = await Promise.all(
        targets.map(async (t) => {
          const runs = await getWorkflowRuns(owner, repo, t.id, 20);
          const stats = summarizeRuns(runs);
          return { workflow_id: t.id, name: t.name, ...stats };
        })
      );

      const payload = { repo: `${owner}/${repo}`, workflows };

      return {
        content: [
          {
            type: "text",
            text: `Comparison widget rendered for ${workflows.length} workflow(s) in ${owner}/${repo}. Don't restate the numbers.`,
          },
        ],
        structuredContent: payload,
        _meta: { ui: { resourceUri: widgetUri("compare") } },
      };
    }
  );

  server.registerResource(
    "Cron job doctor comparison widget",
    widgetUri("compare"),
    { title: "Cron job doctor comparison", mimeType: APP_MIME },
    async () => ({
      contents: [{ uri: widgetUri("compare"), mimeType: APP_MIME, text: widgetHtml("compare") }],
    })
  );
}
