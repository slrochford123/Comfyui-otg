"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StoryConversationTurn, StoryCreatorMessage } from "@/lib/storyCreator/store";

type Snapshot = { turn: StoryConversationTurn | null; message: StoryCreatorMessage | null };
const pending = (turn: StoryConversationTurn | null) => Boolean(turn && ["queued", "running"].includes(turn.status));

/** Reload/reconnect observes server state; it never repeats a generation POST. */
export function useStoryConversation(input: {
  projectId: string; ownerKey: string;
  onMessage: (message: StoryCreatorMessage) => void;
}) {
  const [turn, setTurn] = useState<StoryConversationTurn | null>(null);
  const [error, setError] = useState("");
  const projectRef = useRef(input.projectId);
  const callbackRef = useRef(input.onMessage);
  const wakeRef = useRef<() => void>(() => {});
  useEffect(() => {
    projectRef.current = input.projectId;
    callbackRef.current = input.onMessage;
  });
  const recoveryScope = `${input.ownerKey}:${input.projectId}`;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!input.projectId) return null;
    const response = await fetch(`/api/story-creator/turns?projectId=${encodeURIComponent(input.projectId)}`,
      { credentials: "include", cache: "no-store", signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not reconnect to the saved reply.");
    if (signal?.aborted || projectRef.current !== input.projectId) return null;
    const snapshot = data as Snapshot;
    setTurn(snapshot.turn);
    if (snapshot.message) callbackRef.current(snapshot.message);
    setError(snapshot.turn?.error || "");
    return snapshot.turn;
  }, [input.projectId]);

  useEffect(() => {
    setTurn(null);
    setError("");
    if (!input.projectId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let polling = false;
    const poll = async () => {
      if (polling || controller.signal.aborted) return;
      polling = true;
      let next: StoryConversationTurn | null = null;
      try { next = await refresh(controller.signal); }
      catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Reconnecting to your saved reply…");
      } finally {
        polling = false;
        // Also discover replies started in another tab. Pause network polling while hidden.
        if (!controller.signal.aborted) timer = setTimeout(poll, document.hidden ? 10_000 : pending(next) ? 600 : 15_000);
      }
    };
    const resume = () => { if (!document.hidden) { clearTimeout(timer); void poll(); } };
    wakeRef.current = resume;
    void poll();
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      controller.abort(); clearTimeout(timer);
      wakeRef.current = () => {};
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [recoveryScope, input.projectId, refresh]);

  const start = useCallback(async (sourceMessageId: string, options: { purpose?: "writing"; writingMode?: string } = {}) => {
    const projectId = input.projectId;
    setError("");
    try {
      const response = await fetch("/api/story-creator/turns", { method: "POST", cache: "no-store",
        credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, sourceMessageId, ...options }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start the saved reply.");
      if (projectRef.current === projectId) { setTurn(data.turn); wakeRef.current(); }
    } catch (error) {
      // The server may have accepted it. Reconcile using GET; never blind retry the POST.
      if (projectRef.current === projectId) {
        setError("Your message is saved. Checking whether the reply started; do not send it again.");
        void refresh().catch(() => {});
      }
      throw error;
    }
  }, [input.projectId, refresh]);

  const cancel = useCallback(async () => {
    if (!turn || !pending(turn)) return;
    try {
    const response = await fetch("/api/story-creator/turns", { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel", projectId: input.projectId, turnId: turn.id }) });
    if (!response.ok) { setError("Could not confirm cancellation. Reconnecting to the saved reply…"); return; }
    await refresh();
    } catch {
      setError("Could not confirm cancellation while offline. Reconnect to check the saved reply; it was not resubmitted.");
    }
  }, [turn, input.projectId, refresh]);

  const undoMemory = useCallback(async () => {
    if (!turn?.memoryCanUndo) return;
    try {
      const response = await fetch("/api/story-creator/turns", { method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undo-memory", projectId: input.projectId, turnId: turn.id }) });
      if (!response.ok) throw new Error("Could not undo the saved details. Open Story Memory to review them.");
      await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not undo story memory."); }
  }, [turn, input.projectId, refresh]);

  return { turn, pending: pending(turn), error, start, cancel, refresh, undoMemory };
}
