import { NextRequest } from "next/server";
import { fetchAllVideoLoraInventories } from "@/lib/videoLoraInventory";
import { selectProductionLoraInventory } from "@/lib/productionVideoLoraInventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const refresh = ["1", "true", "yes"].includes(
    String(req.nextUrl.searchParams.get("refresh") || "").toLowerCase()
  );

  try {
    const inventories = await fetchAllVideoLoraInventories({ refresh });
    const selected = selectProductionLoraInventory(inventories);

    if (!selected.ok) {
      return Response.json(selected, { status: 503 });
    }

    return Response.json({
      ok: true,
      loras: selected.loras,
      backend: {
        id: selected.backendId,
        label: selected.backendLabel,
        fallbackActive: selected.fallbackActive,
      },
      refreshed: refresh,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: `Could not load ComfyUI LORA list: ${String(
          error instanceof Error ? error.message : error
        )}`,
      },
      { status: 503 }
    );
  }
}
