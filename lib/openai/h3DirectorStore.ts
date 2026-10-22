import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type H3DirectorTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

export type H3DirectorPromptVersion = {
  id: string;
  prompt: string;
  createdAt: number;
};

export type H3DirectorConversation = {
  id: string;
  ownerKey: string;
  title: string;
  turns: H3DirectorTurn[];
  promptVersions: H3DirectorPromptVersion[];
  createdAt: number;
  updatedAt: number;
};

type Store = {
  conversations: H3DirectorConversation[];
};

function dataRoot() {
  return (
    String(process.env.OTG_DATA_DIR || "").trim() ||
    String(process.env.OTG_DATA_ROOT || "").trim() ||
    path.join(os.homedir(), "AI", "runtime", "test", "data")
  );
}

function ownerPath(ownerKey: string) {
  const safeOwner = String(ownerKey || "local").replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = path.join(dataRoot(), "h3-director");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${safeOwner}.json`);
}

function readStore(ownerKey: string): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(ownerPath(ownerKey), "utf8"));
    return {
      conversations: Array.isArray(parsed?.conversations)
        ? parsed.conversations
        : [],
    };
  } catch {
    return { conversations: [] };
  }
}

function writeStore(ownerKey: string, store: Store) {
  fs.writeFileSync(
    ownerPath(ownerKey),
    JSON.stringify(
      {
        conversations: store.conversations.slice(-50),
      },
      null,
      2,
    ),
  );
}

function cleanText(value: unknown, limit = 20_000) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, limit);
}

export function upsertH3DirectorConversation(args: {
  ownerKey: string;
  conversationId?: string;
  userText: string;
  assistantText: string;
  prompt: string;
}) {
  const now = Date.now();
  const store = readStore(args.ownerKey);
  let conversation = args.conversationId
    ? store.conversations.find((item) => item.id === args.conversationId)
    : null;

  if (!conversation) {
    conversation = {
      id: randomUUID(),
      ownerKey: args.ownerKey,
      title: cleanText(args.userText, 80) || "H3 Scene Director",
      turns: [],
      promptVersions: [],
      createdAt: now,
      updatedAt: now,
    };
    store.conversations.push(conversation);
  }

  conversation.turns.push({
    id: randomUUID(),
    role: "user",
    content: cleanText(args.userText),
    createdAt: now,
  });
  conversation.turns.push({
    id: randomUUID(),
    role: "assistant",
    content: cleanText(args.assistantText),
    createdAt: now,
  });

  const prompt = cleanText(args.prompt, 4000);
  if (prompt) {
    conversation.promptVersions.push({
      id: randomUUID(),
      prompt,
      createdAt: now,
    });
  }

  conversation.turns = conversation.turns.slice(-24);
  conversation.promptVersions = conversation.promptVersions.slice(-20);
  conversation.updatedAt = now;
  writeStore(args.ownerKey, store);
  return conversation;
}

export function getH3DirectorConversation(ownerKey: string, conversationId: string) {
  return readStore(ownerKey).conversations.find((item) => item.id === conversationId) || null;
}

