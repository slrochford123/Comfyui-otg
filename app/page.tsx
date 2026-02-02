"use client";

import { useEffect } from "react";

export default function Home() {
  useEffect(() => {
    // Always land in the app shell; auth gating happens inside /app.
    window.location.replace("/app");
  }, []);
  return null;
}
