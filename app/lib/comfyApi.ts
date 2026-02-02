// app/lib/comfyApi.ts
export const COMFY_BASE_URL = process.env.COMFY_BASE_URL || "http://127.0.0.1:8188";

export async function comfyHistory(promptId: string) {
  const res = await fetch(`${COMFY_BASE_URL}/history/${encodeURIComponent(promptId)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`history failed: ${res.status}`);
  return res.json();
}

// /view?filename=...&subfolder=...&type=...
export async function comfyView(params: { filename: string; subfolder?: string; type?: string }) {
  const url = new URL(`${COMFY_BASE_URL}/view`);
  url.searchParams.set("filename", params.filename);
  url.searchParams.set("subfolder", params.subfolder || "");
  url.searchParams.set("type", params.type || "output");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`view failed: ${res.status}`);
  return res; // binary
}
