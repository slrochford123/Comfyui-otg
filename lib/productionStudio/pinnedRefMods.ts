import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  h3RefModSidecarPath,
  readH3RefModSidecar,
  type H3RefModSidecar,
} from "@/lib/h3SpecialModes/refModCreation";
import { canUseCharacterRefMod } from "@/lib/h3SpecialModes/characterRefCardAccess";
import { isSafeRefModName } from "@/lib/h3SpecialModes/refMods";
import { StudioError } from "./store";

// Comfy's library keys exclude the file extension. Older Production imports
// incorrectly persisted the physical filename as the key. Do not relax H3's
// shared validator, change approved asset metadata, or rename model files.
export function productionRefModName(value: unknown) {
  const raw = String(value ?? "").trim().replaceAll("\\", "/");
  const name = raw.endsWith(".safetensors")
    ? raw.slice(0, -".safetensors".length)
    : raw;
  if (!isSafeRefModName(name))
    throw new StudioError("The pinned RefMod has an invalid library name.", 422);
  return { raw, name };
}

export function productionRefModLocation(sourceName: string, savedPath: string, project: string) {
  const { name } = productionRefModName(sourceName);
  const stem = `studio-${project.slice(0, 8)}-${randomUUID()}`;
  return {
    pinnedName: path.posix.join(path.posix.dirname(name), stem),
    workerFile: path.join(path.dirname(savedPath), `${stem}.safetensors`),
  };
}

/** Resolve an intact, account-owned pinned bundle and preserve its voice/layout.
 * A legacy registry alias is additive and atomic; no production records change.
 */
export async function resolveProductionRefMod(
  owner: string,
  pinned: { libraryName: unknown; sha256: string; characterId?: unknown },
) {
  const { raw, name } = productionRefModName(pinned.libraryName);
  if (!canUseCharacterRefMod(owner, raw) || !canUseCharacterRefMod(owner, name))
    throw new StudioError("This pinned RefMod is not available to this account.", 403);
  const source = readH3RefModSidecar(raw) ?? (raw !== name ? readH3RefModSidecar(name) : null);
  if (!source?.savedPath)
    throw new StudioError("The pinned RefMod is not available to its worker.", 422);
  if (source.ownerKey !== owner ||
      productionRefModName(source.libraryName).name !== name ||
      (pinned.characterId && source.characterId !== String(pinned.characterId)))
    throw new StudioError("The pinned RefMod registry does not match its approved identity.", 409);
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(source.savedPath)) hash.update(chunk);
  if (hash.digest("hex") !== pinned.sha256)
    throw new StudioError(
      "The original RefMod was changed. The pinned version is safe, but must be restored to the worker before rendering.",
      409,
    );
  if (raw !== name) {
    const alias: H3RefModSidecar = { ...source, libraryName: name };
    const target = h3RefModSidecarPath(name);
    const checkAlias = () => {
      if (!isDeepStrictEqual(readH3RefModSidecar(name), alias))
        throw new StudioError("The RefMod library alias conflicts with its pinned bundle. No files were replaced.", 409);
    };
    if (fs.existsSync(target)) checkAlias();
    else {
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await fs.promises.writeFile(temporary, JSON.stringify(alias, null, 2), { flag: "wx", mode: 0o600 });
        try {
          // An atomic, exclusive link: another request cannot observe partial JSON
          // and a concurrent alias or preexisting record can never be overwritten.
          await fs.promises.link(temporary, target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        checkAlias();
      } finally {
        await fs.promises.unlink(temporary).catch(() => undefined);
      }
    }
  }
  return name;
}
