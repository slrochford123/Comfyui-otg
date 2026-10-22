import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCharacterCompletionJob, claimCharacterCompletionJob, checkpointCharacterCompletionJob, failCharacterCompletionJob, resumeCharacterCompletionJob, setCharacterCompletionStorePathForTests, getCharacterCompletionJob, completeCharacterCompletionJob } from "@/lib/jobs/characterCompletionJobs";
let root = "";
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "qa-card-resume-")); setCharacterCompletionStorePathForTests(join(root, "jobs.json")); });
afterEach(() => { setCharacterCompletionStorePathForTests(null); rmSync(root, { recursive: true, force: true }); });
function failed() {
  const created = createCharacterCompletionJob("qa_owner", { characterId: "qa_card", deferCharacterSave: true, sourceImagePath: "/qa/source.png" });
  if (!created.ok) throw Error(created.error);
  claimCharacterCompletionJob("qa-worker");
  checkpointCharacterCompletionJob("qa_owner", created.job.jobId, 78, "Rendered", { orbitsheetsOutput: { promptId: "already-rendered", serverPath: "/qa/card.png" } });
  failCharacterCompletionJob("qa_owner", created.job.jobId, "Upload rejected");
  return created.job.jobId;
}
describe("Owner-scoped Character Card checkpoint recovery", () => {
  it("resumes a failed save without discarding the completed GPU output", () => {
    const id = failed(); const resumed = resumeCharacterCompletionJob("qa_owner", id);
    expect(resumed?.status).toBe("queued"); expect(resumed?.error).toBeNull();
    expect(resumed?.result?.orbitsheetsOutput).toMatchObject({ promptId: "already-rendered" });
    expect(claimCharacterCompletionJob("qa-worker")?.attempt).toBe(2);
  });
  it("refuses a different owner and leaves the original job unchanged", () => {
    const id = failed(); expect(resumeCharacterCompletionJob("other_owner", id)).toBeNull();
    expect(getCharacterCompletionJob("qa_owner", id)?.status).toBe("failed");
  });
  it("does not requeue a completed job or duplicate an active job", () => {
    const id = failed(); resumeCharacterCompletionJob("qa_owner", id);
    expect(resumeCharacterCompletionJob("qa_owner", id)?.status).toBe("queued");
    claimCharacterCompletionJob("qa-worker");
    completeCharacterCompletionJob("qa_owner", id, { status: "completed", characterId: "qa_card", cardImagePath: "/qa/card.png" });
    expect(resumeCharacterCompletionJob("qa_owner", id)?.status).toBe("completed");
    expect(claimCharacterCompletionJob("qa-worker")).toBeNull();
  });
});
