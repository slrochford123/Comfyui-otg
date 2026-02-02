"use client";

import { useSyncExternalStore } from "react";

export type ProgressPhase = "idle" | "queued" | "running" | "done" | "error";

export type ProgressState = {
  connected: boolean;
  phase: ProgressPhase;
  percent: number; // 0-100
  message: string;
  queueRemaining: number | null;
  activePromptId: string | null;
  lastEventTs: number;
};

const defaultState: ProgressState = {
  connected: false,
  phase: "idle",
  percent: 0,
  message: "",
  queueRemaining: null,
  activePromptId: null,
  lastEventTs: 0,
};

let state: ProgressState = { ...defaultState };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setProgressState(patch: Partial<ProgressState>) {
  state = { ...state, ...patch };
  emit();
}

export function resetProgressState() {
  state = { ...defaultState };
  emit();
}

export function getProgressState(): ProgressState {
  return state;
}

/**
 * Minimal zustand-like hook (no deps).
 * Usage:
 *   const { percent } = useProgressStore();
 *   const connected = useProgressStore(s => s.connected);
 */
export function useProgressStore<T = ProgressState>(
  selector?: (s: ProgressState) => T
): T {
  const sel = selector ?? ((s: ProgressState) => s as unknown as T);

  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => sel(state),
    () => sel(state)
  );
}
