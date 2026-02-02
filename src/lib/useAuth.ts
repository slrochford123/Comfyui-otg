// lib/useAuth.ts
"use client";

import { useEffect, useState } from "react";

export function useAuth() {
  const [status, setStatus] = useState<"loading" | "authed" | "unauthed">("loading");
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(async res => {
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
          setStatus("authed");
        } else {
          setStatus("unauthed");
        }
      })
      .catch(() => setStatus("unauthed"));
  }, []);

  return { status, user };
}
