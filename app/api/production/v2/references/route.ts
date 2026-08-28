import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { listAssets } from "@/lib/assets/store";
import { listBackgrounds } from "@/lib/backgrounds/store";
import { listCharacters } from "@/lib/characters/store";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { isProductionFeatureEnabled, productionDisabledResponse } from "@/lib/production/featureGate";
import {
  assetToProductionV2Catalog,
  backgroundToProductionV2Catalog,
  characterToProductionV2Catalog,
} from "@/lib/production/referenceCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: { "Cache-Control": "private, no-store", ...(init?.headers || {}) },
  });
}

export async function GET(req: NextRequest) {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();
  try {
    const { ownerKey } = await getOwnerContext(req);
    return noStore({
      ok: true,
      characters: listCharacters(ownerKey).map(characterToProductionV2Catalog),
      backgrounds: listBackgrounds(ownerKey).map(backgroundToProductionV2Catalog),
      assets: listAssets(ownerKey).map(assetToProductionV2Catalog),
    });
  } catch (error) {
    if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    return noStore({ ok: false, error: error instanceof Error ? error.message : "Could not load Production references." }, { status: 500 });
  }
}
