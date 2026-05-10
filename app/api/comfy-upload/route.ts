import { NextResponse } from "next/server";
import { configuredImageComfyBaseUrl } from "@/app/api/_lib/comfyTarget";

export const runtime = "nodejs"; // IMPORTANT: must be node runtime (not edge)
export const dynamic = "force-dynamic";

function comfyBase() {
  return configuredImageComfyBaseUrl();
}

export async function POST(req: Request) {
  try {
    // Read multipart from browser
    const form = await req.formData();

    const file = form.get("image");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file field 'image'." }, { status: 400 });
    }

    // Optional overrides
    const type = String(form.get("type") ?? "input"); // "input" is what LoadImage uses
    const overwrite = String(form.get("overwrite") ?? "true");

    // Rebuild multipart to send to ComfyUI
    const out = new FormData();
    out.set("image", file, file.name);
    out.set("type", type);
    out.set("overwrite", overwrite);

    const url = `${comfyBase()}/upload/image`;
    const res = await fetch(url, { method: "POST", body: out });

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: `ComfyUI upload failed: HTTP ${res.status}`, details: text },
        { status: 502 }
      );
    }

    // Usually JSON: { name, subfolder, type } (but we accept any)
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    return NextResponse.json(json ?? {});
  } catch (e: any) {
    return NextResponse.json(
      { error: "Upload route crashed", details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
