"use client";
import { useCallback, useEffect, useState } from "react";

/** Device-local, owner/project-scoped unsent text. Never auto-sends a restored draft. */
export function useStoryDraft(ownerKey: string, projectId: string, field: string) {
  const key = ownerKey && projectId
    ? `otg:story:draft:v1:${encodeURIComponent(ownerKey)}:${encodeURIComponent(projectId)}:${field}` : "";
  const [state, setState] = useState({ key: "", value: "" });
  useEffect(() => {
    let value = "";
    try { if (key) value = localStorage.getItem(key) || ""; } catch { /* Optional device storage. */ }
    setState({ key, value });
  }, [key]);
  const setValue = useCallback((value: string) => {
    // An earlier Send may finish after the user switches projects. Clear its
    // saved draft without replacing the new project's on-screen text.
    setState(current => current.key === key ? { key, value } : current);
    try {
      if (key) {
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
      }
    } catch { /* Private browsing/quota failure must not block writing. */ }
  }, [key]);
  return [state.key === key ? state.value : "", setValue] as const;
}
