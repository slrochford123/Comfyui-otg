import type { Job } from "./types";
import { loadJobs, saveJobs } from "./storage";

function now() {
  return Date.now();
}

function makeId() {
  // good enough for v1
  return `job_${now()}_${Math.random().toString(16).slice(2)}`;
}

export function createJobFromPrompt(prompt: string, seed?: number): Job {
  const t = now();
  return {
    id: makeId(),
    createdAt: t,
    updatedAt: t,
    prompt,
    seed,
    status: "queued",
    progress: { pct: 0, message: "Queued" },
    timing: {},
  };
}

export function updateJob(jobs: Job[], jobId: string, patch: Partial<Job>): Job[] {
  return jobs.map((j) => (j.id === jobId ? { ...j, ...patch, updatedAt: now() } : j));
}

export function removeJob(jobs: Job[], jobId: string): Job[] {
  return jobs.filter((j) => j.id !== jobId);
}

export function replaceAllJobs(jobs: Job[]) {
  saveJobs(jobs);
}

export function initJobs(): Job[] {
  return loadJobs();
}
