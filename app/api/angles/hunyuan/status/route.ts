import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch("http://127.0.0.1:8080/config", {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: "Hunyuan config failed.", status: res.status }, { status: 502 });
    }

    const config = await res.json();

    return NextResponse.json({
      ok: true,
      url: "http://127.0.0.1:8080",
      title: config?.title ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        hint: "Run tools\\angles\\start-hunyuan-texture-server.ps1 first.",
      },
      { status: 503 }
    );
  }
}
