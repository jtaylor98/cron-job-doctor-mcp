import { kv } from "@vercel/kv";
import type { Anomaly } from "./github";

const HISTORY_LIMIT = 50; // capped per workflow so this can't grow unbounded

function historyKey(owner: string, repo: string, workflowId: number): string {
  return `history:${owner}/${repo}:${workflowId}`;
}

export interface DiagnosisSnapshot {
  timestamp: string;
  runs_analyzed: number;
  failure_rate_pct: number;
  avg_duration_min: number;
  anomaly_types: string[];
}

/**
 * Records one diagnosis as a point-in-time snapshot. Called every time
 * diagnose_workflow or diagnose_workflow_widget runs, so history builds up
 * naturally from normal use -- no separate "start tracking" step needed.
 */
export async function recordDiagnosis(
  owner: string,
  repo: string,
  workflowId: number,
  stats: { runs_analyzed: number; failure_rate_pct: number; avg_duration_min: number },
  anomalies: Anomaly[]
): Promise<void> {
  const key = historyKey(owner, repo, workflowId);
  const entry: DiagnosisSnapshot = {
    timestamp: new Date().toISOString(),
    runs_analyzed: stats.runs_analyzed,
    failure_rate_pct: stats.failure_rate_pct,
    avg_duration_min: stats.avg_duration_min,
    anomaly_types: anomalies.map((a) => a.type),
  };
  await kv.lpush(key, JSON.stringify(entry));
  await kv.ltrim(key, 0, HISTORY_LIMIT - 1);
}

/** Retrieves past diagnosis snapshots for a workflow, most recent first. */
export async function getDiagnosisHistory(
  owner: string,
  repo: string,
  workflowId: number,
  limit = 20
): Promise<DiagnosisSnapshot[]> {
  const key = historyKey(owner, repo, workflowId);
  const raw = await kv.lrange(key, 0, limit - 1);
  return raw.map((r) => (typeof r === "string" ? JSON.parse(r) : r));
}

/**
 * Compares the current anomaly list against the most recent stored
 * snapshot (if any) to distinguish a brand-new problem from one that's
 * already been showing up in past diagnoses.
 */
export function diffAgainstPrevious(
  currentAnomalyTypes: string[],
  previous: DiagnosisSnapshot | null
): { newTypes: string[]; recurringTypes: string[] } {
  const prevTypes = new Set(previous?.anomaly_types ?? []);
  const newTypes = currentAnomalyTypes.filter((t) => !prevTypes.has(t));
  const recurringTypes = currentAnomalyTypes.filter((t) => prevTypes.has(t));
  return { newTypes, recurringTypes };
}
