import fs from "node:fs";
import path from "node:path";
import { RequestError } from "@/lib/requestError";

export function storageHeadroom(target: string, plannedBytes = 0) {
  let existing = path.resolve(target);
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
  const stat = fs.statfsSync(existing);
  const availableBytes = stat.bavail * stat.bsize;
  const configured = Number(process.env.OTG_MIN_FREE_DISK_GIB || 5);
  const reserveBytes = Math.max(1, Number.isFinite(configured) ? configured : 5) * 1024 ** 3;
  const requiredBytes = reserveBytes + Math.max(0, plannedBytes);
  return { availableBytes, reserveBytes, requiredBytes, ok: availableBytes >= requiredBytes };
}

export function requireStorageHeadroom(target: string, plannedBytes = 0) {
  const result = storageHeadroom(target, plannedBytes);
  if (!result.ok) throw new RequestError("There is not enough free storage to safely finish this operation. Existing media is unchanged; ask the administrator to free space or change the storage location.", 507);
  return result;
}
