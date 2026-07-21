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

/**
 * For write actions (POST/PUT). Separate from githubGet on purpose -- every
 * caller of this function is doing something with a real side effect, and
 * keeping it distinct makes that easy to audit by searching for one name.
 */
async function githubWrite(method: "POST" | "PUT", path: string) {
  const token = requireEnv("GITHUB_TOKEN");
  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  // GitHub returns 204 No Content for several of these write endpoints.
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status} on ${method} ${path}: ${await res.text()}`);
  }

  console.log(`[cron-job-doctor] WRITE ACTION: ${method} ${path} -> ${res.status}`);

  if (res.status === 204) return { success: true };
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
  type: "stuck" | "retry_storm" | "duration_creep" | "recent_failure" | "failure_rate";
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

  // Recent failure: the single most recent run failed. This alone doesn't
  // tell you whether it's an isolated blip or a pattern -- see failure_rate
  // below for that.
  if (latest.conclusion === "failure") {
    anomalies.push({
      type: "recent_failure",
      severity: "high",
      message: `Most recent scheduled run failed (run ${latest.id}).`,
    });
  }

  // Failure rate: scans the whole analyzed window, not just the latest run,
  // so a workflow that's intermittently failing gets flagged even if its
  // most recent run happened to succeed.
  const completed = runs.filter((r) => r.status === "completed");
  const failures = completed.filter((r) => r.conclusion === "failure");
  if (completed.length >= 5 && failures.length >= 2) {
    const rate = failures.length / completed.length;
    anomalies.push({
      type: "failure_rate",
      severity: rate >= 0.25 ? "high" : "medium",
      message: `${failures.length} of the last ${completed.length} runs failed ` +
        `(${Math.round(rate * 100)}% failure rate), even though the most recent ` +
        `run may have succeeded. Worth checking for an intermittent issue.`,
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

// -----------------------------------------------------------------------
// Remediation actions (write). Everything above this line is read-only.
// Everything below has a real side effect on the user's GitHub repo.
// -----------------------------------------------------------------------

/**
 * Re-runs a specific workflow run. Defaults to only re-running the failed
 * jobs within that run (cheaper, faster) rather than the whole run from
 * scratch -- callers can opt into a full re-run if needed.
 */
export async function rerunWorkflow(
  owner: string,
  repo: string,
  runId: number,
  failedJobsOnly = true
) {
  const endpoint = failedJobsOnly ? "rerun-failed-jobs" : "rerun";
  return githubWrite(
    "POST",
    `/repos/${owner}/${repo}/actions/runs/${runId}/${endpoint}`
  );
}

/** Enables or disables a workflow's schedule going forward. */
export async function setWorkflowEnabled(
  owner: string,
  repo: string,
  workflowId: number,
  enabled: boolean
) {
  const action = enabled ? "enable" : "disable";
  return githubWrite(
    "PUT",
    `/repos/${owner}/${repo}/actions/workflows/${workflowId}/${action}`
  );
}

export interface WorkflowSummaryStats {
  runs_analyzed: number;
  failure_rate_pct: number;
  avg_duration_min: number;
  anomaly_count: number;
}

/**
 * Aggregate stats used for comparing multiple workflows side by side --
 * failure rate and average duration across the analyzed window. Shared by
 * diagnose_workflow_widget's single-workflow view and
 * compare_workflows_widget's multi-workflow view, so the two never
 * disagree on how a number is computed.
 */
export function summarizeRuns(runs: WorkflowRun[]): WorkflowSummaryStats {
  const completed = runs.filter((r) => r.status === "completed");
  const failures = completed.filter((r) => r.conclusion === "failure");
  const failure_rate_pct = completed.length > 0
    ? Math.round((failures.length / completed.length) * 100)
    : 0;

  const durations = runs
    .filter((r) => r.run_started_at && r.updated_at)
    .map((r) => (new Date(r.updated_at).getTime() - new Date(r.run_started_at).getTime()) / 60000);
  const avg_duration_min = durations.length > 0
    ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
    : 0;

  return {
    runs_analyzed: runs.length,
    failure_rate_pct,
    avg_duration_min,
    anomaly_count: detectAnomalies(runs).length,
  };
}

