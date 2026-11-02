import fs from "node:fs";
import path from "node:path";

/** Only regular files inside the real workflow root; never follow an escaping link. */
export function workflowFileInside(root: string, relative: string, extensions: string[]) {
  if (!relative || relative.includes("\0") || relative.includes("\\") || path.isAbsolute(relative)) return null;
  try {
    const realRoot = fs.realpathSync(root);
    const candidate = path.resolve(realRoot, relative);
    if (!candidate.startsWith(realRoot + path.sep)) return null;
    const real = fs.realpathSync(candidate);
    if (!real.startsWith(realRoot + path.sep) || !extensions.includes(path.extname(real).toLowerCase())) return null;
    const stat = fs.statSync(real);
    return stat.isFile() && stat.size <= 8 * 1024 * 1024 ? real : null;
  } catch { return null; }
}
