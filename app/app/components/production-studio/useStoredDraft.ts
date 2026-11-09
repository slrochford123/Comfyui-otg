"use client";
import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
/** Small account/project-scoped form drafts, restored without hydration mismatch. */
export function useStoredDraft<T>(
  key: string,
  initial: T,
): [T, (value: SetStateAction<T>) => void] {
  const [initialValue] = useState(initial);
  const get = useCallback(() => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }, [key]);
  const subscribe = useCallback((notify: () => void) => {
    const listener = () => notify();
    window.addEventListener("storage", listener);
    window.addEventListener("production-studio-draft", listener);
    return () => {
      window.removeEventListener("storage", listener);
      window.removeEventListener("production-studio-draft", listener);
    };
  }, []);
  const raw = useSyncExternalStore(subscribe, get, () => null);
  const value = useMemo(() => {
    try {
      return raw === null ? initialValue : (JSON.parse(raw) as T);
    } catch {
      return initialValue;
    }
  }, [raw, initialValue]);
  const set = useCallback(
    (next: SetStateAction<T>) => {
      let previous = initialValue;
      try {
        const raw = get();
        if (raw !== null) previous = JSON.parse(raw);
      } catch {}
      const result =
        typeof next === "function" ? (next as (v: T) => T)(previous) : next;
      try {
        localStorage.setItem(key, JSON.stringify(result));
        window.dispatchEvent(new Event("production-studio-draft"));
      } catch {
        window.dispatchEvent(new Event("production-studio-storage-error"));
      }
    },
    [key, get, initialValue],
  );
  return [value, set];
}
