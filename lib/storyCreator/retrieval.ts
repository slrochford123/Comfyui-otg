import { randomUUID } from "node:crypto";
import { callStoryCpu, storyCpuAvailable, STORY_EMBEDDING_MODEL } from "./cpuClient";
import {
  listStoryRecallSources, syncStoryRecallChunks, searchStoryRecallFts,
  storyRecallEmbeddings, saveStoryRecallEmbedding, type StoryRetrievalChunk,
} from "./store";

export type StoryRecall = {
  factIds: string[];
  notes: Array<{ sourceMessageId: string; content: string }>;
  mode: "hybrid" | "keyword";
  indexedChunks: number;
  totalChunks: number;
};

function passages(text: string) {
  const output: string[] = [];
  for (let offset = 0; offset < Math.min(text.length, 12000); offset += 1200) output.push(text.slice(offset, offset + 1200));
  return output;
}

export function prepareStoryRecall(input: { ownerKey: string; projectId: string }) {
  const source = listStoryRecallSources(input);
  const names = new Map(source.entities.map((entity) => [entity.id, entity.name]));
  const chunks: StoryRetrievalChunk[] = [];
  for (const fact of source.facts) {
    const text = `${fact.subjectEntityId ? names.get(fact.subjectEntityId) || "Story" : "Story"} | ${fact.predicate} | ${fact.objectEntityId ? names.get(fact.objectEntityId) || fact.valueText : fact.valueText}`;
    passages(text).forEach((content, index) => chunks.push({ id: `recall-fact:${fact.id}:${index}`,
      content, chunkType: "recall-canon", sourceMessageId: fact.sourceMessageId, updatedAt: fact.updatedAt }));
  }
  for (const message of source.messages) passages(message.content).forEach((content, index) => chunks.push({
    id: `recall-message:${message.id}:${index}`, content, chunkType: "recall-history",
    sourceMessageId: message.id, updatedAt: message.createdAt,
  }));
  return syncStoryRecallChunks({ ...input, chunks });
}

export async function retrieveStoryMemory(input: { ownerKey: string; projectId: string; query: string }): Promise<StoryRecall> {
  const { chunks } = prepareStoryRecall(input);
  const lexical = searchStoryRecallFts(input);
  const scores = new Map<string, number>();
  lexical.forEach((id, rank) => scores.set(id, 1 / (60 + rank)));
  let mode: StoryRecall["mode"] = "keyword";
  let indexedChunks = 0;
  if (chunks.length && storyCpuAvailable()) {
    try {
      const cached = storyRecallEmbeddings({ ...input, model: STORY_EMBEDDING_MODEL });
      const vectors = new Map(cached.map((item) => [item.id, item.vector]));
      // Bound interactive backfill; remaining chunks are indexed incrementally on later turns.
      const missing = chunks.filter((chunk) => !vectors.has(chunk.id)).slice(0, 64);
      if (missing.length) {
        const batch = await callStoryCpu<{ vectors: number[][] }>("/embed",
          { jobId: randomUUID(), texts: missing.map((chunk) => chunk.content) }, 12_000);
        if (batch.vectors?.length !== missing.length) throw new Error("Incomplete local embedding batch.");
        missing.forEach((chunk, index) => {
          saveStoryRecallEmbedding({ ...input, chunkId: chunk.id, model: STORY_EMBEDDING_MODEL, vector: batch.vectors[index], expectedContent: chunk.content });
          vectors.set(chunk.id, batch.vectors[index]);
        });
      }
      const query = await callStoryCpu<{ vectors: number[][] }>("/embed",
        { jobId: randomUUID(), texts: [input.query.slice(0, 4000)], query: true }, 4_000);
      const needle = query.vectors?.[0];
      if (!needle || needle.length !== 384 || needle.some((n) => !Number.isFinite(n))) throw new Error("Invalid query embedding.");
      const eligible = new Set(chunks.map((chunk) => chunk.id));
      const semantic = [...vectors].filter(([id, vector]) => eligible.has(id) && vector.length === 384)
        .map(([id, vector]) => ({ id, similarity: vector.reduce((sum, value, index) => sum + value * needle[index], 0) }))
        .filter((result) => result.similarity >= 0.45)
        .sort((a, b) => b.similarity - a.similarity).slice(0, 40);
      semantic.forEach(({ id }, rank) => scores.set(id, (scores.get(id) || 0) + 1 / (60 + rank)));
      indexedChunks = vectors.size;
      mode = "hybrid";
    } catch {
      // Explicitly degrade to local keyword recall; never invoke a paid embedder or a media GPU.
    }
  }
  // Recheck eligibility after inference: concurrent deletions must not reappear.
  const currentChunks = prepareStoryRecall(input).chunks;
  const byId = new Map(currentChunks.map((chunk) => [chunk.id, chunk]));
  const ordered = [...scores].sort((a, b) => b[1] - a[1]).map(([id]) => byId.get(id)).filter(Boolean) as StoryRetrievalChunk[];
  const factIds = Array.from(new Set(ordered.filter((chunk) => chunk.chunkType === "recall-canon")
    .map((chunk) => chunk.id.split(":")[1]))).slice(0, 16);
  const seen = new Set<string>();
  const notes = ordered.filter((chunk) => {
    if (chunk.chunkType !== "recall-history" || !chunk.sourceMessageId || seen.has(chunk.sourceMessageId)) return false;
    seen.add(chunk.sourceMessageId);
    return true;
  }).slice(0, 6).map((chunk) => ({ sourceMessageId: chunk.sourceMessageId!, content: chunk.content }));
  return { factIds, notes, mode, indexedChunks, totalChunks: chunks.length };
}
