import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { OTG_DATA_ROOT, safeSegment } from "@/lib/paths";

// A voice-first character has no supplied visual identity yet. Use a neutral,
// original icon, not a generated person's face or an invalid empty image path.
export async function createVoiceCharacterAvatar(owner:string) {
  const root=path.join(OTG_DATA_ROOT,"characters",safeSegment(owner),"voice-avatars");
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const file=path.join(root,`${crypto.randomUUID()}.png`);
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="72" fill="#15152b"/><g fill="none" stroke="#aa95ff" stroke-width="24" stroke-linecap="round"><path d="M256 116v280M196 164v184M316 164v184M136 214v84M376 214v84"/></g></svg>';
  const png=await sharp(Buffer.from(svg)).png().toBuffer();
  fs.writeFileSync(file,png,{flag:"wx",mode:0o600});
  return file;
}
