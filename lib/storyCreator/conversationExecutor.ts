import { randomUUID } from "node:crypto";
import { createOpenAITextStream, openAIModels } from "@/lib/openai/provider";
import { buildStoryDirectorProjectContext } from "./context";
import { storyConversationInstructions, storyConversationOutputTokens } from "./conversationPolicy";
import { retrieveStoryMemory } from "./retrieval";
import { parseStoryConversation, partialStoryReply, STORY_CONVERSATION_SCHEMA, STORY_MEMORY_INSTRUCTION } from "./conversationMemory";
import {
  claimStoryConversationTurn, completeStoryConversationTurn, getStoryConversationTurn,
  listStoryCreatorMessages, updateStoryConversationTurn,
} from "./store";

const active = new Map<string, AbortController>();
type TurnIdentity = { ownerKey: string; projectId: string; turnId: string };
const key = (input: TurnIdentity) => JSON.stringify([input.ownerKey, input.projectId, input.turnId]);

export function abortStoryConversationExecution(input: TurnIdentity) {
  active.get(key(input))?.abort();
}

/** Runs independently of the browser connection. Never automatically replays a lost turn. */
export async function executeStoryConversationTurn(input: TurnIdentity) {
  const leaseToken = randomUUID();
  if (!claimStoryConversationTurn({ ...input, leaseToken })) return;
  const controller = new AbortController();
  active.set(key(input), controller);
  const scope = { ...input, leaseToken };
  let text = "";
  let lastFlush = 0;
  const heartbeat = setInterval(() => {
    try {
      const turn = getStoryConversationTurn(input);
      if (!turn || turn.cancelRequested) controller.abort();
      else updateStoryConversationTurn(scope);
    } catch {
      controller.abort();
    }
  }, 5_000);
  heartbeat.unref?.();
  try {
    const turn = getStoryConversationTurn(input)!;
    const allMessages = listStoryCreatorMessages(input);
    const sourceIndex = allMessages.findIndex((message) => message.id === turn.sourceMessageId);
    if (sourceIndex < 0) throw new Error("Saved source message is unavailable.");
    const source = allMessages[sourceIndex];
    const recall = await retrieveStoryMemory({ ...input, query: source.content });
    const projectContext = buildStoryDirectorProjectContext({ ...input, query: source.content, recall });
    const events = await createOpenAITextStream({
      ownerKey: input.ownerKey, projectId: input.projectId, useCase: turn.purpose === "writing" ? "story-write" : "story-helper",
      model: openAIModels().story,
      instructions: `${storyConversationInstructions(projectContext.context)}\n${STORY_MEMORY_INSTRUCTION}${turn.purpose === "writing" ? `\nWRITING WORKSPACE: Produce the requested ${turn.writingMode} as reply, not a short acknowledgment. Honor established canon and the user's current direction. New creative details are draft proposals, not established canon. Return an empty facts array. Preserve useful scene/action/dialogue formatting.` : ""}`,
      input: allMessages.slice(0, sourceIndex + 1).slice(-48).map(({ role, content }) => ({ role, content })),
      maxOutputTokens: storyConversationOutputTokens(source.content),
      timeoutMs: 120_000, signal: controller.signal, maxRetries: 0,
      responseSchema: STORY_CONVERSATION_SCHEMA,
    });
    let completed = false;
    for await (const event of events) {
      if (controller.signal.aborted || getStoryConversationTurn(input)?.cancelRequested) {
        controller.abort();
        throw new Error("Cancelled");
      }
      if (event.type === "delta") {
        text += event.delta;
        if (Date.now() - lastFlush > 200) {
          updateStoryConversationTurn({ ...scope, partialText: partialStoryReply(text) });
          lastFlush = Date.now();
        }
      } else if (event.type === "done") {
        text = event.text;
        completed = true;
      }
    }
    if (!completed || !text.trim()) throw new Error("No completed reply was received.");
    const parsed = parseStoryConversation(text, source.content);
    const saved = completeStoryConversationTurn({ ...scope, content: parsed.reply, memory: turn.purpose === "writing" ? undefined : parsed.memory });
    if (!saved) updateStoryConversationTurn({ ...scope, terminal: "cancelled", partialText: parsed.reply });
  } catch {
    const cancelled = controller.signal.aborted || getStoryConversationTurn(input)?.cancelRequested;
    updateStoryConversationTurn({ ...scope, partialText: partialStoryReply(text), terminal: cancelled ? "cancelled" : "failed",
      error: cancelled ? "Reply cancelled. Your message is saved."
        : "The reply could not finish. Your message is saved; it was not automatically resubmitted." });
  } finally {
    clearInterval(heartbeat);
    active.delete(key(input));
  }
}
