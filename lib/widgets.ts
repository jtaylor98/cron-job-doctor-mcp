import { z } from "zod";
import { getWorkflowRuns, detectAnomalies } from "./github";
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
        "Render a workflow's diagnosis as an interactive widget: health status " +
        "and any flagged anomalies (stuck, retry storm, duration creep, recent " +
        "failure, failure rate). Use when the user wants to SEE the diagnosis " +
        "visually rather than read it as text. Pass owner, repo, and " +
        "workflow_id. PRESENTATION: the widget shows the anomalies -- " +
        "summarize briefly, don't restate them.",
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
      };
      return {
        content: [
          {
            type: "text",
            text: `Diagnosis widget rendered for workflow ${workflow_id}: ${anomalies.length} anomaly(ies) found. Don't restate them.`,
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
}
