import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("image");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing image file" }, { status: 400 });
  }

  const comfyBase = process.env.COMFY_BASE_URL;
  if (!comfyBase) {
    return NextResponse.json({ error: "COMFY_BASE_URL not set" }, { status: 500 });
  }

  const fd = new FormData();
  fd.append("image", file, file.name);
  fd.append("overwrite", "true");

  const res = await fetch(`${comfyBase}/upload/image`, { method: "POST", body: fd });
  const text = await res.text();

  if (!res.ok) {
    return NextResponse.json({ error: "ComfyUI upload failed", details: text }, { status: 502 });
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "ComfyUI returned non-JSON", raw: text }, { status: 502 });
  }

  const filename = json?.name || json?.filename;
  if (!filename) {
    return NextResponse.json({ error: "Could not extract filename", raw: json }, { status: 502 });
  }

  return NextResponse.json({ filename });
}
