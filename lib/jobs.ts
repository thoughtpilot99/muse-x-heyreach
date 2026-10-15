import { config, missingKeys, MissingKeysError } from "./config";
import { logEvent } from "./db";
import { runGovernor } from "./governor";
import { pollInbox } from "./inbox";
import { draftNewLeads, pushApproved } from "./outreach";

type Job = { name: string; everyMs: number; fn: () => Promise<unknown> };

// The governor runs before every push so caps always reflect the latest health.
const JOBS: Job[] = [
  { name: "draft_new_leads", everyMs: 60_000, fn: () => draftNewLeads() },
  { name: "governor_and_push", everyMs: 10 * 60_000, fn: async () => { await runGovernor(); await pushApproved(); } },
  { name: "poll_inbox", everyMs: 10 * 60_000, fn: () => pollInbox() },
];

const g = globalThis as unknown as { __rgJobs?: boolean; __rgRunning?: Set<string> };

async function tick(job: Job) {
  const running = (g.__rgRunning ??= new Set());
  if (running.has(job.name) || missingKeys().length) return;
  running.add(job.name);
  try {
    await job.fn();
  } catch (e) {
    // Pushing simply waits while live mode is off.
    if (!(e instanceof MissingKeysError)) {
      logEvent({ source: "jobs", kind: job.name, ok: false, note: e instanceof Error ? e.message : String(e) });
    }
  } finally {
    running.delete(job.name);
  }
}

export function startJobs() {
  if (g.__rgJobs || !config.jobsEnabled()) return;
  g.__rgJobs = true;
  for (const job of JOBS) setInterval(() => void tick(job), job.everyMs).unref?.();
}
