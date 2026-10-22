import { NextRequest, NextResponse } from "next/server";
import { getOwnerContext } from "@/lib/ownerKey";
import { chooseMossBackend } from "@/lib/images/mossBackend";
import { mossTarget } from "@/lib/images/mossImage";
import { mossPhysicallyQualified } from "@/lib/images/mossQualification";
import { voiceGpuFileBusy } from "@/lib/workers/voiceGpuFileLease";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    await getOwnerContext(request);
    const target = mossTarget(request.nextUrl.searchParams.get("target") ?? undefined);
    const backend = await chooseMossBackend(target);
    const queues = await Promise.all([backend.baseUrl, ...(target === "3090" ? ["http://100.75.162.64:8189"] : [])].map(async base => {
      const response = await fetch(base + "/queue", { cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw Error("MOSS GPU queue status unavailable.");
      const queue = await response.json();
      if (!Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) throw Error("MOSS GPU queue status unavailable.");
      return queue;
    }));
    const busy = queues.some(queue => queue.queue_running.length + queue.queue_pending.length > 0) || target === "3090" && voiceGpuFileBusy();
    const qualified = mossPhysicallyQualified(target);
    const state = busy ? "busy" : qualified ? "ready" : "installed";
    const message = busy ? "Busy — another operation is using the selected GPU." : qualified ? "Ready — MOSS generation physically qualified on this GPU; worker queues are clear. Capacity is rechecked on submission." : "MOSS model and native nodes installed. Physical qualification pending; worker capacity is checked on submission.";
    return NextResponse.json({ installed: true, qualified, state, message }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MOSS unavailable.";
    return NextResponse.json({ error: message }, { status: /session|auth/i.test(message) ? 401 : /Choose RTX/.test(message) ? 400 : 503 });
  }
}
