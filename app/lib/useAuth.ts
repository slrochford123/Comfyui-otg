"use client";

function getDeviceId(): string {
  if (typeof window === "undefined") return "desktop_default";
  return (
    localStorage.getItem("otg_device_id") ||
    sessionStorage.getItem("otg_device_id") ||
    "desktop_default"
  );
}
import { useEffect, useState } from "react";

type User = { email: string };

type AuthState =
  | { status: "loading"; user: null }
  | { status: "authed"; user: User }
  | { status: "unauthed"; user: null };

let cached: AuthState | null = null;
let inFlight: Promise<AuthState> | null = null;

function getLastAuthedEmail(): string | null {
  try {
    return sessionStorage.getItem("otg_last_authed_email");
  } catch {
    return null;
  }
}
function setLastAuthedEmail(email: string | null) {
  try {
    if (email) sessionStorage.setItem("otg_last_authed_email", email);
    else sessionStorage.removeItem("otg_last_authed_email");
  } catch {}
}

async function fetchAuth(): Promise<AuthState> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const ts = Date.now(); // cache-buster for SW/proxies
    try {
      const res = await fetch(`/api/auth/me?ts=${ts}`, {
        credentials: "include",
        cache: "no-store",
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache", "x-otg-device-id": (getDeviceId() ?? "desktop_default") },
      });

      if (!res.ok) return { status: "unauthed", user: null };

      const data = await res.json();
      const user = (data.user ?? null) as User | null;

      if (user?.email) {
        setLastAuthedEmail(user.email);
        return { status: "authed", user };
      }
      return { status: "unauthed", user: null };
    } catch {
      // If we were authed recently, don't flip to unauthed because of a transient failure.
      if (cached?.status === "authed") return cached;

      const email = getLastAuthedEmail();
      if (email) return { status: "authed", user: { email } };

      return { status: "unauthed", user: null };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>(cached ?? { status: "loading", user: null });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const next = await fetchAuth();
      cached = next;
      if (!cancelled) setState(next);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export async function refreshAuth() {
  cached = { status: "loading", user: null };
  return fetchAuth();
}

