"use client";
import { useRef, useState } from "react";
import { mossSourceTarget } from "@/lib/images/mossSourceTarget";
export default function MossGallerySaveButton({ imageUrl, promptId, backend, origin, prompt = "", seed = "" }: {
  imageUrl: string; promptId: string; backend: string;
  origin: "character" | "freeform-character" | "background" | "asset"; prompt?: string; seed?: string | number;
}) {
  const guard = useRef(false);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  async function save() {
    if (guard.current || state === "saved") return;
    guard.current = true; setState("saving"); setError("");
    try {
      const url = new URL(imageUrl, location.origin);
      if (url.origin !== location.origin) throw Error("Use the saved local MOSS candidate.");
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw Error("Could not read this MOSS candidate.");
      const data = new FormData(); data.set("image", await response.blob(), "moss.png");
      data.set("origin", origin); data.set("promptId", promptId); data.set("gpuTarget", mossSourceTarget(backend, imageUrl));
      data.set("prompt", prompt); data.set("seed", String(seed));
      const saved = await fetch("/api/images/moss-gallery", { method: "POST", body: data });
      const body = await saved.json(); if (!saved.ok) throw Error(body.error || "Gallery save failed.");
      setState("saved");
    } catch (e) { setError(e instanceof Error ? e.message : "Gallery save failed."); setState("idle"); }
    finally { guard.current = false; }
  }
  return <div className="col-span-2"><button type="button" disabled={state !== "idle"} onClick={() => void save()} className="min-h-11 w-full rounded-xl border border-[var(--color-primary-border)] bg-[var(--color-primary-muted)] p-2 text-sm font-semibold text-[var(--color-text)]">{state === "saved" ? "Saved to Gallery" : state === "saving" ? "Saving to Gallery…" : "Save to Gallery"}</button>{error ? <p role="alert" className="text-sm text-[var(--color-error)]">{error}</p> : null}</div>;
}
