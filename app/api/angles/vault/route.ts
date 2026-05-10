import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type VaultKind = "mesh" | "model" | "trellis";
type VaultItem = {
  id: string;
  kind: VaultKind;
  name: string;
  modelUrl: string;
  ext?: string;
  previewSupported: boolean;
  createdAt: string;
  path: string;
};

function jsonError(status: number, error: string, detail?: unknown) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

function safeSegment(raw: string) {
  return (raw || "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "item";
}

function isWithin(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function parseSourcePath(modelUrl: string): string | null {
  try {
    const u = new URL(modelUrl, "http://otg.local");
    if (u.pathname !== "/api/file") return null;
    const rawPath = u.searchParams.get("path") || "";
    if (!rawPath) return null;
    return path.resolve(decodeURIComponent(rawPath));
  } catch {
    return null;
  }
}

function allowedModelExt(ext: string): boolean {
  return [".glb", ".gltf", ".obj", ".stl", ".ply"].includes(ext.toLowerCase());
}

function getAllowedRoots(dataRoot: string, ownerKey: string): string[] {
  const tmpRoot = path.resolve(path.join(dataRoot, "tmp"));
  return [
    path.resolve(path.join(dataRoot, "tmp", "angles_preview")),
    path.resolve(path.join(dataRoot, "tmp", "angles_models")),
    path.resolve(path.join(dataRoot, "tmp", "angles_trellis")),
    path.resolve(path.join(dataRoot, "tmp", "angles_created")),
    tmpRoot,
    path.resolve(path.join(dataRoot, "angles_vault", ownerKey)),
  ];
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function readIndex(indexFile: string): Promise<VaultItem[]> {
  try {
    const raw = await fs.readFile(indexFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

async function writeIndex(indexFile: string, items: VaultItem[]) {
  await ensureDir(path.dirname(indexFile));
  await fs.writeFile(indexFile, JSON.stringify({ items }, null, 2), "utf8");
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const dataRoot = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
    const vaultRoot = path.join(dataRoot, "angles_vault", owner.ownerKey);
    const indexFile = path.join(vaultRoot, "index.json");
    const items = await readIndex(indexFile);
    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) return jsonError(401, "Unauthorized");
    return jsonError(500, "Failed to load vault", e?.message || String(e));
  }
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const body = await req.json().catch(() => null);
    const kind = String(body?.kind || "") as VaultKind;
    const name = String(body?.name || "").trim();
    const modelUrl = String(body?.modelUrl || "").trim();
    const ext = String(body?.ext || path.extname(modelUrl) || ".glb").trim() || ".glb";
    const previewSupported = Boolean(body?.previewSupported);

    if (!(kind === "mesh" || kind === "model" || kind === "trellis")) return jsonError(400, "Invalid vault kind");
    if (!name) return jsonError(400, "Model name is required before saving to vault.");
    if (!modelUrl) return jsonError(400, "Missing model URL");
    if (!allowedModelExt(ext)) return jsonError(400, "Unsupported model file type", { ext });

    const sourcePath = parseSourcePath(modelUrl);
    if (!sourcePath) {
      return jsonError(400, "Unsupported model source URL. Expected an OTG /api/file URL.", { modelUrl });
    }
    if (!fssync.existsSync(sourcePath)) {
      return jsonError(404, "Source model file not found", { sourcePath });
    }

    const dataRoot = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
    const vaultRoot = path.resolve(path.join(dataRoot, "angles_vault", owner.ownerKey));
    const allowedRoots = getAllowedRoots(dataRoot, owner.ownerKey);
    const allowed = allowedRoots.some((root) => isWithin(root, sourcePath));
    if (!allowed) {
      return jsonError(400, "Source path is outside allowed OTG model roots.", {
        sourcePath,
        allowedRoots,
      });
    }

    const id = crypto.randomUUID();
    const safeName = safeSegment(name);
    const kindDir = path.join(vaultRoot, kind);
    await ensureDir(kindDir);
    const finalExt = ext.startsWith(".") ? ext : `.${ext}`;
    const destPath = path.join(kindDir, `${safeName}_${id}${finalExt}`);
    await fs.copyFile(sourcePath, destPath);

    const item: VaultItem = {
      id,
      kind,
      name,
      modelUrl: `/api/file?path=${encodeURIComponent(destPath)}`,
      ext: finalExt,
      previewSupported,
      createdAt: new Date().toISOString(),
      path: destPath,
    };

    const indexFile = path.join(vaultRoot, "index.json");
    const items = await readIndex(indexFile);
    items.unshift(item);
    await writeIndex(indexFile, items);
    return NextResponse.json({ ok: true, item, items });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) return jsonError(401, "Unauthorized");
    return jsonError(500, "Failed to save vault item", e?.message || String(e));
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const body = await req.json().catch(() => null);
    const id = String(body?.id || "").trim();
    if (!id) return jsonError(400, "Missing vault item id");

    const dataRoot = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
    const vaultRoot = path.resolve(path.join(dataRoot, "angles_vault", owner.ownerKey));
    const indexFile = path.join(vaultRoot, "index.json");
    const items = await readIndex(indexFile);
    const item = items.find((entry) => entry.id === id);
    if (!item) return jsonError(404, "Vault item not found");

    const resolved = path.resolve(item.path);
    if (isWithin(vaultRoot, resolved) && fssync.existsSync(resolved)) {
      await fs.unlink(resolved).catch(() => {});
    }
    const next = items.filter((entry) => entry.id !== id);
    await writeIndex(indexFile, next);
    return NextResponse.json({ ok: true, items: next });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) return jsonError(401, "Unauthorized");
    return jsonError(500, "Failed to delete vault item", e?.message || String(e));
  }
}
