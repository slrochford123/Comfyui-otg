import {
  acquireResourceLock,
  setResourceLockStorePathForTests,
} from "../../../lib/workers/resourceLocks";

const [storePath, ownerId, startAtText] = process.argv.slice(2);
if (!storePath || !ownerId || !startAtText) throw new Error("Missing contender arguments.");

setResourceLockStorePathForTests(storePath);
const startAt = Number(startAtText);
while (Date.now() < startAt) {
  // Deliberately synchronize independent processes onto the same acquisition window.
}

const result = acquireResourceLock({
  lockId: "gpu:linux-5060ti",
  ownerId,
  ownerType: "job",
  workerId: "test-contender",
  ttlSeconds: 60,
});
process.stdout.write(JSON.stringify(result));
