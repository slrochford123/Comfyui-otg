import fs from "node:fs";
/** Explicit private owner opt-in, never inferred from Admin, NODE_ENV or browser flags. */
export function h3StudioOwnerExperimental(ownerKey?: string): boolean {
  if (process.env.OTG_ENV !== "test" || !ownerKey || !process.getuid || process.getuid() === 0) return false;
  const file = process.env.OTG_H3_STUDIO_EXPERIMENTAL_FILE;
  if (!file?.startsWith("/")) return false;
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > 16_000) return false;
      const policy = JSON.parse(fs.readFileSync(fd, "utf8"));
      return policy.schemaVersion === 1 && policy.enabled === true && policy.environment === "test" && policy.target === "3090"
        && Array.isArray(policy.ownerKeys) && policy.ownerKeys.includes(ownerKey) && typeof policy.authorizationReference === "string" && !!policy.authorizationReference.trim();
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}
