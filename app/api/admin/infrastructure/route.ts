import fs from "node:fs/promises";
import path from "node:path";
import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import { OTG_DATA_ROOT } from "@/lib/paths";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return Response.json({error:auth.error},{status:auth.status});
  try {
    const file=path.join(OTG_DATA_ROOT,"infrastructure/status.json");
    const stat=await fs.lstat(file);
    if(!stat.isFile()||stat.size>131072)throw Error("Invalid telemetry");
    const data=JSON.parse(await fs.readFile(file,"utf8"));
    if(data.schemaVersion!==1||!Number.isFinite(data.checkedAt)||!Array.isArray(data.hosts))throw Error("Invalid telemetry");
    return Response.json({...data,stale:Date.now()-data.checkedAt>180000},{headers:{"Cache-Control":"private, no-store"}});
  } catch {return Response.json({error:"Infrastructure telemetry is not available yet."},{status:503,headers:{"Cache-Control":"private, no-store"}});}
}
