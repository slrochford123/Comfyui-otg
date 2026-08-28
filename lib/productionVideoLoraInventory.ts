import type { VideoLoraBackendInventory } from "@/lib/videoLoraInventory";

export type ProductionLoraOption = {
  name: string;
};

export type ProductionLoraInventorySelection =
  | {
      ok: true;
      backendId: string;
      backendLabel: string;
      fallbackActive: boolean;
      loras: ProductionLoraOption[];
    }
  | {
      ok: false;
      error: string;
    };

export function isSafeProductionLoraName(value: unknown) {
  const name = String(value || "").trim();
  if (!name || name.length > 512 || /[\u0000-\u001f\u007f]/.test(name)) return false;
  const normalized = name.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[a-z]:\//i.test(normalized) ||
    !/\.(safetensors|pt|pth|ckpt|bin)$/i.test(normalized)
  ) {
    return false;
  }
  const segments = normalized.split("/");
  return segments.every((segment) => Boolean(segment) && segment !== "." && segment !== "..");
}

export function selectProductionLoraInventory(
  inventories: VideoLoraBackendInventory[]
): ProductionLoraInventorySelection {
  const primary = inventories.find((inventory) => inventory.backendId === "rtx3090");
  const fallback = inventories.find((inventory) => inventory.backendId === "rtx5060ti");
  const selected = primary?.ok ? primary : fallback?.ok ? fallback : null;

  if (!selected) {
    const reasons = [primary, fallback]
      .filter(Boolean)
      .map((inventory) => `${inventory?.backendLabel || inventory?.backendId}: ${inventory?.error || "inventory unavailable"}`);
    return {
      ok: false,
      error: `Could not load ComfyUI LORA list${reasons.length ? `: ${reasons.join("; ")}` : "."}`,
    };
  }

  const deduped = new Map<string, string>();
  for (const item of selected.items) {
    const exactFilename = String(item.exactFilename || "").trim();
    if (!isSafeProductionLoraName(exactFilename)) continue;
    const key = exactFilename.replaceAll("\\", "/").toLocaleLowerCase();
    if (!deduped.has(key)) deduped.set(key, exactFilename);
  }

  const loras = [...deduped.values()]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map((name) => ({ name }));

  return {
    ok: true,
    backendId: selected.backendId,
    backendLabel: selected.backendLabel,
    fallbackActive: selected.backendId === "rtx5060ti",
    loras,
  };
}
