import { NextRequest } from "next/server";
import { fetchAllVideoLoraInventories } from "@/lib/videoLoraInventory";
import {
  detectVideoWorkflowFamily,
  loadVideoLoraCatalog,
  normalizeVideoLoraFilename,
  videoWorkflowMode,
} from "@/lib/videoLoras";
import { videoBackends } from "@/lib/videoBackendFailover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const workflowId = String(req.nextUrl.searchParams.get("workflowId") || "").trim();
  const refresh = ["1", "true", "yes"].includes(String(req.nextUrl.searchParams.get("refresh") || "").toLowerCase());
  const family = detectVideoWorkflowFamily(workflowId);
  const mode = videoWorkflowMode(workflowId);
  if (!workflowId || !family || !mode) {
    return Response.json({ ok: false, error: "A supported Wan or LTX workflowId is required." }, { status: 400 });
  }
  const catalog = loadVideoLoraCatalog();
  const inventories = await fetchAllVideoLoraInventories({ refresh });
  const installedByBackend = Object.fromEntries(inventories.map((inventory) => [
    inventory.backendId,
    new Set(inventory.items.map((item) => item.normalizedFilename)),
  ])) as Record<string, Set<string>>;
  const entries = catalog.entries
    .filter((entry) => entry.family === family)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName))
    .map((entry) => {
      const workflowCompatible = entry.supportedWorkflowIds.includes(workflowId) && entry.supportedModes.includes(mode);
      const selectable = entry.catalogStatus === "active" && workflowCompatible;
      const normalizedFilename = normalizeVideoLoraFilename(entry.filename);
      const installedState = Object.fromEntries(inventories.map((inventory) => [inventory.backendId, {
        installed: installedByBackend[inventory.backendId]?.has(normalizedFilename) || false,
        inventoryAvailable: inventory.ok,
      }]));
      const compatibilityReason = entry.catalogStatus !== "active"
        ? "Catalog metadata is incomplete; this LoRA is not selectable."
        : !workflowCompatible
          ? `${entry.displayName} does not support ${mode} in this workflow.`
          : null;
      return {
        id: entry.id,
        displayName: entry.displayName,
        family: entry.family,
        baseModelVariant: entry.baseModelVariant,
        supportedModes: entry.supportedModes,
        description: entry.description,
        triggerWords: entry.triggerWords,
        recommendedStrength: entry.recommendedStrength,
        defaultStrength: entry.recommendedStrength,
        allowedRange: { minimum: entry.minimumStrength, maximum: entry.maximumStrength },
        promptExample: entry.promptExample,
        dependencies: entry.dependencies,
        limitations: entry.limitations,
        license: entry.license,
        commercialUse: entry.commercialUse,
        sourceUrl: entry.sourceUrl || null,
        catalogStatus: entry.catalogStatus,
        selectable,
        installedState,
        compatibilityReason,
      };
    });
  const primary = videoBackends().primary;
  return Response.json({
    ok: true,
    workflowId,
    family,
    mode,
    selectedBackend: { id: primary.id, label: primary.label, gpu: primary.gpu },
    entries,
    compatibleEntries: entries.filter((entry) => entry.selectable),
    inventories: inventories.map((inventory) => ({
      backendId: inventory.backendId,
      backendLabel: inventory.backendLabel,
      ok: inventory.ok,
      retrievedAt: inventory.retrievedAt,
      itemCount: inventory.items.length,
      nodeSupport: inventory.nodeSupport,
      sources: inventory.sources,
      error: inventory.error,
    })),
    cacheTtlSeconds: 45,
  });
}
