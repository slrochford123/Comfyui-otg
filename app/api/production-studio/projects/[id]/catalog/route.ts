import { NextRequest } from "next/server";
import {
  authorize,
  body,
  studio,
  json,
  failure,
} from "@/lib/productionStudio/server";
import { catalog, importCatalogAsset } from "@/lib/productionStudio/catalog";
import { groupedAssets } from "@/lib/productionStudio/assetGroups";
import { assertAssetIntact,snapshotFile } from "@/lib/productionStudio/media";
import { getGallerySourcesForRequest,resolveGalleryItemByName } from "@/lib/gallery";
import { assertOwnerMediaFile } from "@/lib/ownerMediaAccess";
import { StudioError } from "@/lib/productionStudio/store";
import {
  storyCatalog,
  importStoryPlan,
  publishStoryPlan,
} from "@/lib/productionStudio/planning";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type C = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, c: C) {
  try {
    const u = await authorize(req),
      { id } = await c.params;
    studio().get(u.ownerKey, id);
    const productions=studio().list(u.ownerKey).filter(p=>p.id!==id).flatMap(p=>groupedAssets(studio().assets(u.ownerKey,p.id)).filter(a=>a.kind!=="refmod"&&a.kind!=="video").map(a=>({...a,productionName:p.name})));
    return json({ ...catalog(u.ownerKey), productions, stories: storyCatalog(u.ownerKey) });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest, c: C) {
  try {
    const u = await authorize(req, true),
      { id } = await c.params,
      b = await body(req);
    studio().get(u.ownerKey,id);
    if(b.kind==="production"){
      const from=String(b.sourceProject),entry=await assertAssetIntact(studio(),u.ownerKey,from,String(b.sourceId)),meta={...entry.asset.metadata};
      const copy=async(assetId:string)=>{const a=await assertAssetIntact(studio(),u.ownerKey,from,assetId);return snapshotFile(studio(),u.ownerKey,id,a.path,a.asset.name,a.asset.kind,{...a.asset.metadata,sourceProduction:from,sourceAssetId:assetId});};
      if(entry.asset.kind==="character"){
        const images=Array.isArray(meta.imageIds)?meta.imageIds.map(String):[];meta.imageIds=await Promise.all(images.map(async v=>(await copy(v)).id));
        if(meta.voiceId)meta.voiceId=(await copy(String(meta.voiceId))).id;
        if(meta.bundleId)meta.bundleId=(await copy(String(meta.bundleId))).id;
      }
      return json({asset:await snapshotFile(studio(),u.ownerKey,id,entry.path,entry.asset.name,entry.asset.kind,{...meta,sourceProduction:from,sourceAssetId:entry.asset.id})},201);
    }
    if(b.kind==="gallery"){
      const {sources}=await getGallerySourcesForRequest(req),entry=resolveGalleryItemByName({sources,name:String(b.sourceId),scopeHint:String(b.scope||"")});
      if(!entry||entry.kind!=="image")throw new StudioError("Gallery image not found.",404);
      assertOwnerMediaFile(entry.path,u.ownerKey);
      return json({asset:await snapshotFile(studio(),u.ownerKey,id,entry.path,entry.name,"image",{sourceGalleryName:entry.name})},201);
    }
    if (b.kind === "story")
      return json({
        project: importStoryPlan(
          studio(),
          u.ownerKey,
          id,
          String(b.sourceId),
          b.revision,
        ),
      });
    if (b.kind === "publish-story")
      return json({
        project: publishStoryPlan(studio(), u.ownerKey, id, b.expectedVersion, b.revision),
      });
    return json(
      {
        asset: await importCatalogAsset(
          studio(),
          u.ownerKey,
          id,
          String(b.kind),
          String(b.sourceId),
        ),
      },
      201,
    );
  } catch (e) {
    return failure(e);
  }
}
