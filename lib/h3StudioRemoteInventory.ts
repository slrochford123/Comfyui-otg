import { execFile } from "node:child_process";
import type { H3StudioAssetFileIdentity } from "@/lib/h3StudioRegistry";

/** TEST-only read-only file identity probe. Neither host nor command is supplied
 * by the browser. Hashes come from the owner installation receipt; every use
 * checks that the hashed files have not been replaced or modified. */
export const H3_REMOTE_FILE_PROBE = String.raw`
import json, pathlib, socket, sys
if socket.gethostname() != 'slr': raise RuntimeError('Wrong H3 model host')
request = json.load(sys.stdin)
if not isinstance(request, dict) or len(request) > 100: raise RuntimeError('Invalid model receipt')
roots = [pathlib.Path('/opt/ComfyUI/models').resolve(strict=True),
         pathlib.Path('/mnt/otg_fast'), pathlib.Path('/mnt/otg_1tb'), pathlib.Path('/mnt/otg_bulk')]
verified = []
for name, expected in request.items():
    location = expected.get('path', '')
    if not isinstance(location, str) or not location.startswith('/opt/ComfyUI/models/'): continue
    candidate = pathlib.Path(location)
    if '..' in candidate.parts: continue
    try:
        candidate = candidate.resolve(strict=True)
        if not any(candidate.is_relative_to(root) for root in roots) or not candidate.is_file(): continue
        s = candidate.stat()
        if (s.st_dev == expected.get('dev') and s.st_ino == expected.get('ino')
            and s.st_size == expected.get('size') and str(s.st_mtime_ns) == expected.get('mtimeNs')
            and str(s.st_ctime_ns) == expected.get('ctimeNs')): verified.append(name)
    except OSError: continue
print(json.dumps({'host': 'slr', 'verified': verified}))
`;

export type H3RemoteAssetFileIdentity = H3StudioAssetFileIdentity & { mtimeNs: string; ctimeNs: string };
export async function verifyH3RemoteAssetFiles(files: Record<string, H3RemoteAssetFileIdentity>) {
  if (process.env.OTG_ENV !== "test" || !Object.keys(files).length || Object.keys(files).length > 100) return [];
  const command = `/usr/bin/python3 -c 'exec(bytes.fromhex("${Buffer.from(H3_REMOTE_FILE_PROBE).toString("hex")}"))'`;
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=4", "-o", "StrictHostKeyChecking=yes", "otg-slr", command],
      { timeout: 8_000, maxBuffer: 128_000, encoding: "utf8" }, (error, stdout) => error ? reject(new Error("H3 remote model identity check unavailable.")) : resolve(stdout));
    child.stdin?.on("error", () => { /* exec callback handles remote failures */ });
    child.stdin?.end(JSON.stringify(files));
  });
  const parsed = JSON.parse(output);
  if (parsed.host !== "slr" || !Array.isArray(parsed.verified) || parsed.verified.some((file: unknown) => typeof file !== "string" || !Object.hasOwn(files, file))) throw new Error("Invalid H3 remote model identity response.");
  return parsed.verified as string[];
}
