import { NextRequest } from "next/server";
import { validateCreateAssets } from "@/lib/productionStudio/createActions";
import { approvedStoryKey } from "@/lib/productionStudio/createManifest";
import {assertAssetIntact} from "@/lib/productionStudio/media";
import {workingClips} from "@/lib/productionStudio/workflow";
import {
  authorize,
  body,
  studio,
  json,
  failure,
} from "@/lib/productionStudio/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type C = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, c: C) {
  try {
    const u = await authorize(req),
      { id } = await c.params,
      s = studio();
    if (req.nextUrl.searchParams.has("revisions"))
      return json({ revisions: s.revisions(u.ownerKey, id) });
    if (req.nextUrl.searchParams.has("previewRevision")) {
      const p = s.revisionProject(u.ownerKey, id, Number(req.nextUrl.searchParams.get("previewRevision")));
      return json({ revision: p.revision, updatedAt: p.updatedAt, summary: p.lastChange || "Saved production changes", plan: p.plan });
    }
    const project = s.get(u.ownerKey,id);
    return json({
      project,
      creationCurrent: project.plan.status === "approved" && project.creation?.storyKey === approvedStoryKey(project),
      assets: s.assets(u.ownerKey, id),
      jobs: s.jobs(u.ownerKey, id),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: NextRequest, c: C) {
  try {
    const u = await authorize(req, true),
      { id } = await c.params,
      b = await body(req);
    if(String(b.operation?.type||"").startsWith("create.")) await validateCreateAssets(studio(),u.ownerKey,id,b.operation);
    if(b.operation?.type==="storyboard.approve"){
      const p=studio().get(u.ownerKey,id),clips=b.operation.shotId?p.plan.acts.flatMap(a=>a.scenes.flatMap(s=>s.shots)).filter(c=>c.id===b.operation.shotId):workingClips(p);
      for(const clip of clips){const settings=p.shots[clip.id];for(const assetId of [settings?.storyboardId,...(settings?.storyboardFrames||[]).map(f=>f.assetId)].filter(Boolean) as string[])await assertAssetIntact(studio(),u.ownerKey,id,assetId);}
    }
    return json({
      project: studio().mutate(u.ownerKey, id, b.revision, b.operation),
    });
  } catch (e) {
    return failure(e);
  }
}
