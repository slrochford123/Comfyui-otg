import fs from "node:fs";
import path from "node:path";

import { OTG_DATA_ROOT, ensureDir, safeJoin, safeSegment } from "@/lib/paths";
import {
  assertProductionV2,
  createProductionV2,
  normalizeProductionV2,
  type ProductionV2,
  type ProductionV2Model,
  type ProductionV2Status,
  type ProductionV2Summary,
} from "@/lib/production/v2";

export type ProductionV2Store = ReturnType<typeof createProductionV2Store>;

function readJson(filePath: string) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath: string, value: unknown) {
  ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function toSummary(production: ProductionV2): ProductionV2Summary {
  return {
    id: production.id,
    name: production.name,
    status: production.status,
    defaultModel: production.defaultModel,
    createdAt: production.createdAt,
    updatedAt: production.updatedAt,
    completedAt: production.completedAt,
    sceneCount: production.scenes.length,
    activeSceneId: production.activeSceneId,
  };
}

export function createProductionV2Store(dataRoot = OTG_DATA_ROOT) {
  const root = path.join(path.resolve(dataRoot), "productions-v2");

  function ownerRoot(ownerKey: string) {
    const directory = safeJoin(root, safeSegment(ownerKey || "local"));
    ensureDir(directory);
    return directory;
  }

  function productionRoot(ownerKey: string, productionId: string) {
    return safeJoin(ownerRoot(ownerKey), safeSegment(productionId));
  }

  function productionFile(ownerKey: string, productionId: string) {
    return safeJoin(productionRoot(ownerKey, productionId), "production.json");
  }

  function activeFile(ownerKey: string) {
    return safeJoin(ownerRoot(ownerKey), "active.json");
  }

  function load(ownerKey: string, productionId: string): ProductionV2 | null {
    const raw = readJson(productionFile(ownerKey, productionId));
    if (!raw || raw.schemaVersion !== 2) return null;
    try {
      return assertProductionV2(normalizeProductionV2(raw));
    } catch {
      return null;
    }
  }

  function getActiveId(ownerKey: string) {
    const value = readJson(activeFile(ownerKey));
    const id = String(value?.productionId || "").trim();
    return id || null;
  }

  function setActive(ownerKey: string, productionId: string | null) {
    const filePath = activeFile(ownerKey);
    if (!productionId) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // An absent active pointer is already the requested state.
      }
      return null;
    }
    const production = load(ownerKey, productionId);
    if (!production) throw new Error("Production not found.");
    if (production.status === "completed") throw new Error("Completed productions cannot become the active draft.");
    writeJsonAtomic(filePath, { productionId: production.id });
    return production;
  }

  function getActive(ownerKey: string) {
    const id = getActiveId(ownerKey);
    if (!id) return null;
    const production = load(ownerKey, id);
    if (!production || production.status === "completed") {
      setActive(ownerKey, null);
      return null;
    }
    return production;
  }

  function save(ownerKey: string, input: ProductionV2) {
    const normalized = assertProductionV2(normalizeProductionV2(input));
    const existing = load(ownerKey, normalized.id);
    const now = new Date().toISOString();
    const production: ProductionV2 = {
      ...normalized,
      createdAt: existing?.createdAt || normalized.createdAt || now,
      updatedAt: now,
      completedAt: normalized.status === "completed" ? normalized.completedAt || now : null,
    };
    writeJsonAtomic(productionFile(ownerKey, production.id), production);
    if (production.status === "draft") {
      writeJsonAtomic(activeFile(ownerKey), { productionId: production.id });
    } else if (getActiveId(ownerKey) === production.id) {
      setActive(ownerKey, null);
    }
    return production;
  }

  function create(ownerKey: string, name: string, defaultModel: ProductionV2Model) {
    return save(ownerKey, createProductionV2(name, defaultModel));
  }

  function list(ownerKey: string, status?: ProductionV2Status) {
    const directory = ownerRoot(ownerKey);
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => load(ownerKey, entry.name))
      .filter((production): production is ProductionV2 => Boolean(production))
      .filter((production) => !status || production.status === status)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(toSummary);
  }

  function remove(ownerKey: string, productionId: string) {
    const directory = productionRoot(ownerKey, productionId);
    const existed = fs.existsSync(directory);
    if (existed) fs.rmSync(directory, { recursive: true, force: true });
    const clearedActive = getActiveId(ownerKey) === safeSegment(productionId);
    if (clearedActive) setActive(ownerKey, null);
    return { deleted: existed, clearedActive };
  }

  function complete(ownerKey: string, productionId: string) {
    const production = load(ownerKey, productionId);
    if (!production) throw new Error("Production not found.");
    return save(ownerKey, { ...production, status: "completed", completedAt: new Date().toISOString() });
  }

  return {
    root,
    create,
    save,
    load,
    list,
    remove,
    complete,
    getActive,
    getActiveId,
    setActive,
    summarize: toSummary,
  };
}

export const productionV2Store = createProductionV2Store();
