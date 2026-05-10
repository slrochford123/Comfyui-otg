import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { OTG_DATA_ROOT } from "@/lib/paths";

type DirStats = {
  path: string;
  exists: boolean;
  files: number;
  dirs: number;
  bytes: number;
  ms: number;
};

function walkDir(root: string, maxFiles = 30_000): DirStats {
  const startedAt = performance.now();
  const stats: DirStats = { path: root, exists: false, files: 0, dirs: 0, bytes: 0, ms: 0 };

  try {
    if (!fs.existsSync(root)) {
      stats.ms = Math.round(performance.now() - startedAt);
      return stats;
    }

    stats.exists = true;
    const stack = [root];
    while (stack.length && stats.files < maxFiles) {
      const current = stack.pop()!;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stats.dirs += 1;
          stack.push(full);
          continue;
        }
        if (!entry.isFile()) continue;
        stats.files += 1;
        try {
          stats.bytes += fs.statSync(full).size || 0;
        } catch {
          // ignore inaccessible files
        }
      }
    }
  } finally {
    stats.ms = Math.round(performance.now() - startedAt);
  }

  return stats;
}

function bytesLabel(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function countRouteCacheHeaders() {
  const apiRoot = path.join(process.cwd(), "app", "api");
  const result = { routeFiles: 0, noStoreMentions: 0, cacheableMentions: 0 };
  if (!fs.existsSync(apiRoot)) return result;

  const stack = [apiRoot];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile() || entry.name !== "route.ts") continue;
      result.routeFiles += 1;
      const raw = fs.readFileSync(full, "utf8");
      if (/no-store/i.test(raw)) result.noStoreMentions += 1;
      if (/max-age|etag|accept-ranges|stale-while-revalidate/i.test(raw)) result.cacheableMentions += 1;
    }
  }

  return result;
}

function readDependencyVersions() {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    return {
      next: deps.next || null,
      react: deps.react || null,
      reactQuery: deps["@tanstack/react-query"] || null,
      reactVirtual: deps["@tanstack/react-virtual"] || null,
      sharp: deps.sharp || null,
    };
  } catch {
    return {};
  }
}

export function collectAdminPerformanceSnapshot() {
  const startedAt = performance.now();
  const dataRoot = OTG_DATA_ROOT;
  const dirs = {
    dataRoot: walkDir(dataRoot),
    userGalleries: walkDir(path.join(dataRoot, "user_galleries")),
    deviceGalleries: walkDir(path.join(dataRoot, "device_galleries")),
    thumbnails: walkDir(path.join(dataRoot, "thumbs")),
    editVideoJobs: walkDir(path.join(dataRoot, "edit_video_jobs")),
    voiceTtsJobs: walkDir(path.join(dataRoot, "voice_tts_jobs")),
    voiceDubJobs: walkDir(path.join(dataRoot, "voice_dub_jobs")),
    nextStatic: walkDir(path.join(process.cwd(), ".next", "static")),
  };

  const totalMediaBytes =
    dirs.userGalleries.bytes +
    dirs.deviceGalleries.bytes +
    dirs.editVideoJobs.bytes +
    dirs.voiceTtsJobs.bytes +
    dirs.voiceDubJobs.bytes;
  const routeCache = countRouteCacheHeaders();

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    ms: Math.round(performance.now() - startedAt),
    node: process.version,
    env: process.env.NODE_ENV || "development",
    dataRoot,
    dirs,
    totals: {
      mediaBytes: totalMediaBytes,
      mediaSize: bytesLabel(totalMediaBytes),
      thumbnailFiles: dirs.thumbnails.files,
      thumbnailSize: bytesLabel(dirs.thumbnails.bytes),
      nextStaticSize: bytesLabel(dirs.nextStatic.bytes),
    },
    routeCache,
    dependencies: readDependencyVersions(),
    recommendations: [
      routeCache.noStoreMentions > routeCache.cacheableMentions
        ? "Several API routes still use no-store. Keep it for live state, but completed media routes should use private cache headers."
        : "Completed media routes are now mostly cacheable.",
      dirs.thumbnails.files === 0
        ? "Thumbnail cache is empty. Generate or sync media to warm thumbnails."
        : "Thumbnail cache is populated.",
      dirs.userGalleries.files + dirs.deviceGalleries.files > 1000
        ? "Large gallery detected. Prefer cached search and paged browsing for best responsiveness."
        : "Gallery size is currently manageable.",
    ],
  };
}
