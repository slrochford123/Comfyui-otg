import fs from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { requireNsfwAccess } from "@/lib/experiments/nsfwAccess";
import { readMetaForFile } from "@/lib/gallery";
export async function assertNsfwMediaAccess(request:NextRequest,file:string) {
 let directory=path.dirname(file),marked=readMetaForFile(file).mediaCategory==="nsfw";
 for(let depth=0;depth<4&&!marked;depth++){marked=fs.existsSync(path.join(directory,".nsfw-media"));directory=path.dirname(directory);}
 if(!marked)return;
 const user=await requireSessionUser(request);requireNsfwAccess(user.accountId||"");
}
