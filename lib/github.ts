const GITHUB_API_BASE = "https://api.github.com";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function githubGet(path: string) {
  const token = requireEnv("GITHUB_TOKEN");
  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status} on ${path}: ${await res.text()}`);
  }

  return res.json();
}

export interface WorkflowSummary {
  id: number;
  name: string;
  path: string;
  state: string;
}

export interface WorkflowRun {
  id: number;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | ...
  created_at: string;
  run_started_at: string;
  updated_at: string;
}

/** Lists all workflows in a repo. Doesn't filter by trigger type -- see isScheduledWorkflow. */
export async function listWorkflows(owner: string, repo: string): Promise<WorkflowSummary[]> {
  const data = await githubGet(`/repos/${owner}/${repo}/actions/workflows?per_page=100`);
  return data.workflows.map((w: any) => ({
    id: w.id,
    name: w.name,
    path: w.path,
    state: w.state,
  }));
}

/**
 * GitHub's workflow list doesn't expose trigger type directly, so we check
 * the raw YAML for a `schedule:` key. This is a heuristic, not a full YAML
 * parse -- good enough to filter out obviously non-scheduled workflows.
 */
export async function isScheduledWorkflow(
  owner: string,
  repo: string,
  path: string
): Promise<boolean> {
  const token = requireEnv("GITHUB_TOKEN");
  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!res.ok) return false;
  const text = await res.text();
  return /^\s*schedule:\s*$/m.test(text) || /^\s{2,}-\s*cron:/m.test(text);
}

/**
 * Fetches recent runs for a workflow. Includes both schedule-triggered and
 * manually-triggered (workflow_dispatch) runs, since both are useful history
 * for diagnosing a workflow -- and manual runs are how you'd generate test
 * data without waiting for the actual cron schedule to fire.
 */
export async function getWorkflowRuns(
  owner: string,
  repo: string,
  workflowId: number,
  limit = 20
): Promise<WorkflowRun[]> {
  const [scheduled, manual] = await Promise.all([
    githubGet(
      `/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs?event=schedule&per_page=${limit}`
    ),
    githubGet(
      `/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs?event=workflow_dispatch&per_page=${limit}`
    ),
  ]);

  const allRuns = [...scheduled.workflow_runs, ...manual.workflow_runs];
  allRuns.sort(
    (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return allRuns.slice(0, limit).map((r: any) => ({
    id: r.id,
    status: r.status,
    conclusion: r.conclusion,
    created_at: r.created_at,
    run_started_at: r.run_started_at,
    updated_at: r.updated_at,
  }));
}

export interface Anomaly {
  type: "stuck" | "retry_storm" | "duration_creep" | "recent_failure";
  severity: "low" | "medium" | "high";
  message: string;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Heuristic anomaly detection based on each workflow's own run history --
 * no cron-expression parsing required. Runs must be sorted newest-first
 * (which is what GitHub's API returns by default).
 */
export function detectAnomalies(runs: WorkflowRun[]): Anomaly[] {
  const anomalies: Anomaly[] = [];
  if (runs.length === 0) return anomalies;

  const latest = runs[0];

  // Recent failure
  if (latest.conclusion === "failure") {
    anomalies.push({
      type: "recent_failure",
      severity: "high",
      message: `Most recent scheduled run failed (run ${latest.id}).`,
    });
  }

  if (runs.length < 3) return anomalies; // not enough history for the rest

  // Gaps between consecutive runs, in minutes
  const timestamps = runs.map((r) => new Date(r.created_at).getTime());
  const gaps: number[] = [];
  for (let i = 0; i < timestamps.length - 1; i++) {
    gaps.push((timestamps[i] - timestamps[i + 1]) / 60000);
  }
  const historicalGaps = gaps.slice(1); // exclude most recent gap, use as baseline
  const medianGap = median(historicalGaps);
  const mostRecentGap = gaps[0];
  const minutesSinceLastRun = (Date.now() - timestamps[0]) / 60000;

  // Stuck: it's been far longer than the typical gap since the last run fired at all
  if (medianGap > 0 && minutesSinceLastRun > medianGap * 2.5) {
    anomalies.push({
      type: "stuck",
      severity: "high",
      message: `No scheduled run in ${Math.round(minutesSinceLastRun / 60)}h, but the ` +
        `typical gap between runs is ~${Math.round(medianGap / 60)}h. The schedule may ` +
        `have silently stopped firing.`,
    });
  }

  // Retry storm: most recent gap is much shorter than the historical median
  if (medianGap > 0 && mostRecentGap < medianGap * 0.2) {
    anomalies.push({
      type: "retry_storm",
      severity: "medium",
      message: `Last run fired only ${Math.round(mostRecentGap)}m after the previous one, ` +
        `vs a typical ~${Math.round(medianGap)}m gap. Possible retry loop.`,
    });
  }

  // Duration creep: latest run duration vs historical median duration
  const durations = runs
    .filter((r) => r.run_started_at && r.updated_at)
    .map((r) => (new Date(r.updated_at).getTime() - new Date(r.run_started_at).getTime()) / 60000);
  if (durations.length >= 3) {
    const [latestDuration, ...historicalDurations] = durations;
    const medianDuration = median(historicalDurations);
    if (medianDuration > 0 && latestDuration > medianDuration * 3) {
      anomalies.push({
        type: "duration_creep",
        severity: "medium",
        message: `Latest run took ${Math.round(latestDuration)}m vs a typical ` +
          `~${Math.round(medianDuration)}m. Worth checking before it eventually times out.`,
      });
    }
  }

  return anomalies;
}
