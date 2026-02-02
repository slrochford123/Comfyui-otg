"use client";

import { useEffect, useMemo, useState, useCallback } from "react";

function isBrowser() {
  return typeof window !== "undefined";
}

export default function InstallBubble() {
  // ✅ hooks always run in the same order
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const canUseBrowser = useMemo(() => mounted && isBrowser(), [mounted]);

  const onInstall = useCallback(() => {
    if (!canUseBrowser) return;
    // your install logic here
  }, [canUseBrowser]);

  // ✅ this useEffect must ALWAYS be called (not skipped by early return)
  useEffect(() => {
    if (!canUseBrowser) return;

    const handler = () => void onInstall();
    window.addEventListener("otg:install", handler);
    return () => window.removeEventListener("otg:install", handler);
  }, [canUseBrowser, onInstall]);

  // ✅ render decision happens AFTER hooks
  if (!canUseBrowser) return null;

  return (
    <div>
      {/* your bubble UI */}
    </div>
  );
}
