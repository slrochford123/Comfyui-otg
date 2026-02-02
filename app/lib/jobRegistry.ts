// app/lib/jobRegistry.ts
import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const JOBS_DIR = path.join(DATA_DIR, "jobs_registry"); // simple local registry

export type JobMeta = {
  promptId: string;
  deviceId: string;
  workflowName: string; // e.g. "WanT2V"
  createdAt: string;
};

export async function saveJobMeta(meta: JobMeta) {
  await fs.mkdir(JOBS_DIR, { recursive: true });
  await fs.writeFile(path.join(JOBS_DIR, `${meta.promptId}.json`), JSON.stringify(meta, null, 2), "utf-8");
}

export async function loadJobMeta(promptId: string): Promise<JobMeta | null> {
  try {
    const p = path.join(JOBS_DIR, `${promptId}.json`);
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
