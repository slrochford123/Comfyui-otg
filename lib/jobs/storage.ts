import type { Job } from "./types";

const KEY = "comfy_otg_jobs_v1";
const MAX_JOBS = 50;

export function loadJobs(): Job[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Job[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveJobs(jobs: Job[]) {
  if (typeof window === "undefined") return;
  try {
    const trimmed = jobs.slice(0, MAX_JOBS);
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // ignore
  }
}
