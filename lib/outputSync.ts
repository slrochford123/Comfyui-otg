import fs from "node:fs";
import path from "node:path";

export type LatestOutputMatch = {
  absPath: string;
  fileName: string;
  mtimeMs: number;
};

function safeLower(s: string) {
  return (s || "").toLowerCase();
}

function looksLikeMedia(name: string) {
  const n = safeLower(name);
  return (
    n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".webp") || n.endsWith(".gif") ||
    n.endsWith(".mp4") || n.endsWith(".webm") || n.endsWith(".mov") || n.endsWith(".mkv")
  );
}


function isProbablyTempFile(name: string) {
  const n = safeLower(name);
  return n.endsWith(".tmp") || n.endsWith(".part") || n.includes("~");
}

/**
 * Find the newest media in `outputDir` that:
 *  - was modified after `sinceMs` (with a small grace window)
 *  - and includes `ownerKey` and (optionally) `workflowName` in the filename
 */
export function findLatestOutputFile(args: {
  outputDir: string;
  ownerKey: string;
  workflowName?: string;
  sinceMs?: number;
}): LatestOutputMatch | null {
  const { outputDir, ownerKey, workflowName } = args;
  const sinceMs = typeof args.sinceMs === "number" ? args.sinceMs : 0;
  const grace = 5000; // allow a few seconds clock/flush jitter

  if (!outputDir) return null;
  if (!fs.existsSync(outputDir)) return null;

  const ownerNeedle = safeLower(ownerKey);
  const wfNeedle = workflowName ? safeLower(workflowName) : "";

  let best: LatestOutputMatch | null = null;
  let bestScore = -1;

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(outputDir);
  } catch {
    return null;
  }

  for (const fileName of entries) {
    if (!looksLikeMedia(fileName)) continue;
    if (isProbablyTempFile(fileName)) continue;

    const lower = safeLower(fileName);
    if (wfNeedle && !lower.includes(wfNeedle)) {
      // if workflow name doesn't match, still allow, but de-prioritize.
      // We'll handle priority by comparing mtime only; skipping would be too strict
    }

    const absPath = path.join(outputDir, fileName);
    let st: fs.Stats;
    try {
      st = fs.statSync(absPath);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;

    const mtimeMs = st.mtimeMs || st.mtime.getTime();
    if (sinceMs && mtimeMs + grace < sinceMs) continue;

        const score = (ownerNeedle && lower.includes(ownerNeedle) ? 2 : 0) + (wfNeedle && lower.includes(wfNeedle) ? 1 : 0);
    if (!best || score > bestScore || (score === bestScore && mtimeMs > best.mtimeMs)) {
      best = { absPath, fileName, mtimeMs };
      bestScore = score;
    }
  }

  return best;
}

export function copyFileIntoDir(
  srcAbsOrArgs: string | { srcAbs: string; destDir: string; destFileName?: string },
  destDirMaybe?: string,
  destFileNameMaybe?: string
): string {
  const srcAbs = typeof srcAbsOrArgs === "string" ? srcAbsOrArgs : srcAbsOrArgs.srcAbs;
  const destDir = typeof srcAbsOrArgs === "string" ? (destDirMaybe as string) : srcAbsOrArgs.destDir;
  const destFileName =
    typeof srcAbsOrArgs === "string" ? destFileNameMaybe : srcAbsOrArgs.destFileName;

  if (!destDir) throw new Error("copyFileIntoDir: missing destDir");
  fs.mkdirSync(destDir, { recursive: true });
  const base = destFileName || path.basename(srcAbs);
  const destAbs = path.join(destDir, base);
  if (srcAbs !== destAbs) {
    fs.copyFileSync(srcAbs, destAbs);
  }
  return base;
}


// Backwards-compat alias
export const copyToDir = copyFileIntoDir;
