/* Controlled, real CPU embedding check. Requires a new isolated QA data directory. */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const evidence = process.argv[2];
if (!evidence || !process.env.STORY_CREATOR_CPU_ROOT) throw new Error("Explicit evidence and CPU root required.");
const data = path.join(evidence, "recall-data");
fs.mkdirSync(data, { mode: 0o700 });
process.env.OTG_DATA_DIR = data;
process.env.OTG_DATA_ROOT = data;
const store = require("../../lib/storyCreator/store.ts");
const { retrieveStoryMemory } = require("../../lib/storyCreator/retrieval.ts");
(async () => {
  const project = store.createStoryCreatorProject({ ownerKey: "recall-qa", title: "Childhood recall fixture" });
  const scope = { ownerKey: project.ownerKey, projectId: project.id };
  const source = store.addStoryCreatorMessage({ ...scope, role: "user", content: "Mara was brought up by her grandmother Elin. Elin took care of her throughout her childhood." });
  const entity = store.createStoryBibleEntity({ ...scope, name: "Mara", entityType: "character", sourceRole: "user", sourceMessageId: source.id });
  const fact = store.addStoryBibleFact({ ...scope, subjectEntityId: entity.id, predicate: "childhood_caregiver", valueText: "Mara was brought up by her grandmother Elin.", canonStatus: "canon", sourceRole: "user", sourceMessageId: source.id });
  for (let i = 0; i < 60; i++) store.addStoryCreatorMessage({ ...scope, role: "user", content: `Scene ${i}: the café has ${i + 2} wooden tables, white cups, and bright windows.` });
  const query = "Who raised the heroine when she was a young girl?";
  const rows = [];
  for (const run of ["first-index", "warm-index"]) {
    const started = performance.now();
    const result = await retrieveStoryMemory({ ...scope, query });
    rows.push({ run, elapsedSeconds: (performance.now() - started) / 1000, ...result });
    assert.equal(result.mode, "hybrid");
    assert(result.factIds.includes(fact.id), "Paraphrased childhood question did not retrieve the established caregiver.");
  }
  await assert.rejects(retrieveStoryMemory({ ownerKey: "another-owner", projectId: project.id, query }));
  store.deleteStoryCanonFact({ ...scope, factId: fact.id });
  const deleted = await retrieveStoryMemory({ ...scope, query });
  assert(!deleted.factIds.includes(fact.id));
  assert(!deleted.notes.some(note => note.sourceMessageId === source.id));
  fs.writeFileSync(path.join(evidence, "real-recall.json"), JSON.stringify({ query, rows, deletionPassed: true, ownerIsolationPassed: true }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ok: true, runs: rows.map(({ run, mode, indexedChunks, totalChunks, elapsedSeconds }) => ({ run, mode, indexedChunks, totalChunks, elapsedSeconds })), deletionPassed: true, ownerIsolationPassed: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
