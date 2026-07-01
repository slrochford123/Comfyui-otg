import fs from "fs";
import path from "path";

const MEDIA_EXTS = new Set([".png",".jpg",".jpeg",".webp",".gif",".mp4",".webm",".mov",".mkv"]);

const SOURCE_DIR = process.env.OTG_AUTOSYNC_SOURCE; // REQUIRED
const BASE_DEST_DIR = process.env.OTG_AUTOSYNC_DEST || "/mnt/otg_gallery/data/device_galleries";
const STATE_DIR  = process.env.OTG_AUTOSYNC_STATE_DIR || "/mnt/otg_gallery/data/sync_state";
const DEFAULT_OWNER = process.env.OTG_AUTOSYNC_DEFAULT_OWNER || "local";

const INTERVAL_MS = Math.max(2000, Number(process.env.OTG_AUTOSYNC_INTERVAL_MS || 5000));
const RECURSIVE   = !["0","false","no"].includes(String(process.env.OTG_AUTOSYNC_RECURSIVE || "1").toLowerCase());
const MAX_DEPTH   = Math.max(0, Math.min(12, Number(process.env.OTG_AUTOSYNC_MAX_DEPTH || 8)));

if (!SOURCE_DIR) {
  console.error("[sync] OTG_AUTOSYNC_SOURCE is required");
  process.exit(2);
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function statePath() {
  ensureDir(STATE_DIR);
  return path.join(STATE_DIR, "autosync.json");
}

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath(), "utf8")); }
  catch { return { lastScanMs: 0 }; }
}

function writeState(st) {
  fs.writeFileSync(statePath(), JSON.stringify(st, null, 2), "utf8");
}

function isMedia(name) {
  return MEDIA_EXTS.has(path.extname(name).toLowerCase());
}

/**
 * Owner parsing rule:
 * - If file is like:  <ownerKey>__<rest_of_name>
 *   then ownerKey=<ownerKey>, cleanName=<rest_of_name>
 * - Else ownerKey=DEFAULT_OWNER, cleanName=baseName
 */
function parseOwnerFromName(baseName) {
  const m = baseName.match(/^([a-zA-Z0-9_-]{1,64})__(.+)$/);
  if (!m) return { ownerKey: DEFAULT_OWNER, cleanName: baseName };
  return { ownerKey: m[1], cleanName: m[2] };
}

function destDirForOwner(ownerKey) {
  return path.join(BASE_DEST_DIR, ownerKey);
}

function safeCopy(srcAbs, destAbs) {
  // skip if already exists with same size/mtime-ish
  try {
    const s = fs.statSync(srcAbs);
    const d = fs.statSync(destAbs);
    if (d.size === s.size && d.mtimeMs >= s.mtimeMs) return false;
  } catch {}

  ensureDir(path.dirname(destAbs));
  fs.copyFileSync(srcAbs, destAbs);

  try {
    const s = fs.statSync(srcAbs);
    fs.utimesSync(destAbs, s.atime, s.mtime);
  } catch {}

  return true;
}

function ensureMeta(ownerDir, cleanName, srcAbs) {
  const metaPath = path.join(ownerDir, `${cleanName}.meta.json`);
  if (fs.existsSync(metaPath)) return;

  const meta = {
    ts: Date.now(),
    ownerKey: path.basename(ownerDir),
    source: { absPath: srcAbs },
    note: "Autosync sidecar. Images may contain embedded ComfyUI metadata; videos rely on this unless overwritten later."
  };

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
}

function* walk(root) {
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(cur.dir, { withFileTypes: true }); }
    catch { continue; }

    for (const e of entries) {
      const abs = path.join(cur.dir, e.name);

      if (e.isDirectory()) {
        if (RECURSIVE && cur.depth < MAX_DEPTH) {
          stack.push({ dir: abs, depth: cur.depth + 1 });
        }
        continue;
      }

      if (!e.isFile()) continue;
      if (!isMedia(e.name)) continue;

      yield abs;
    }
  }
}

function scanOnce() {
  const st = readState();
  const now = Date.now();

  let scanned = 0;
  let copied = 0;

  if (!fs.existsSync(SOURCE_DIR)) {
    console.log(`[sync] SOURCE missing: ${SOURCE_DIR}`);
    writeState({ lastScanMs: now });
    return;
  }

  ensureDir(BASE_DEST_DIR);

  for (const abs of walk(SOURCE_DIR)) {
    scanned++;

    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }

    if (st.lastScanMs && stat.mtimeMs <= st.lastScanMs) continue;

    const baseName = path.basename(abs);
    const { ownerKey, cleanName } = parseOwnerFromName(baseName);

    const ownerDir = destDirForOwner(ownerKey);
    ensureDir(ownerDir);

    const destAbs = path.join(ownerDir, cleanName);

    try {
      const didCopy = safeCopy(abs, destAbs);
      if (didCopy) {
        ensureMeta(ownerDir, cleanName, abs);
        copied++;
      }
    } catch {}
  }

  writeState({ lastScanMs: now });
  console.log(`[sync] scanned=${scanned} copied=${copied} source=${SOURCE_DIR} destBase=${BASE_DEST_DIR}`);
}

console.log(`[sync] starting interval=${INTERVAL_MS}ms source=${SOURCE_DIR} destBase=${BASE_DEST_DIR}`);
scanOnce();
setInterval(scanOnce, INTERVAL_MS);
