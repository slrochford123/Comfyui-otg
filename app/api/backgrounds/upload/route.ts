import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

import {
  backgroundImageUrlForPath,
  backgroundUploadDir,
  listBackgrounds,
  safeBackgroundUploadName,
  saveBackground,
} from "@/lib/backgrounds/store";
import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: {
      "Cache-Control": "private, no-store",
      ...(init?.headers || {}),
    },
  });
}

function cleanString(value: unknown, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function parseDoNotChange(value: unknown) {
  return String(value || "")
    .split(/\r?\n|,/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 24);
}

export async function POST(req: NextRequest) {
  try {
    const owner = await requireSessionUser(req);
    if (owner.scope !== "user" || !owner.username) {
      throw new SessionInvalidError("An authenticated Background account is required.");
    }
    const form = await req.formData();
    const file = form.get("file") || form.get("image") || form.get("background");

    if (!file || typeof file === "string") {
      return noStore({ ok: false, error: "Background image file is required." }, { status: 400 });
    }

    const sourceName = cleanString((file as File).name, "background.png");
    const outDir = backgroundUploadDir(owner.ownerKey);
    const fileName = safeBackgroundUploadName(sourceName);
    const imagePath = path.join(outDir, fileName);
    const bytes = Buffer.from(await (file as File).arrayBuffer());

    if (!bytes.length) {
      return noStore({ ok: false, error: "Uploaded background image is empty." }, { status: 400 });
    }

    await fs.writeFile(imagePath, bytes);

    const imageUrl = backgroundImageUrlForPath(imagePath);
    const temporary = ["1", "true", "yes"].includes(
      cleanString(form.get("temporary")).toLowerCase(),
    );

    if (temporary) {
      return noStore({
        ok: true,
        temporaryCandidate: true,
        imagePath,
        imageUrl,
      }, { status: 201 });
    }

    const name =
      cleanString(form.get("name")) ||
      sourceName.replace(/\.[a-z0-9]+$/i, "") ||
      "Uploaded Background";

    const background = saveBackground(owner.ownerKey, {
      type: "background",
      name,
      locationType: cleanString(form.get("locationType")),
      style: cleanString(form.get("style"), "cinematic realistic"),
      masterPrompt: cleanString(form.get("masterPrompt") || form.get("prompt")),
      continuityBlock: cleanString(form.get("continuityBlock")),
      doNotChange: parseDoNotChange(form.get("doNotChange")),
      source: "uploaded",
      imagePath,
      imageUrl,
      displayImage: imageUrl,
      workflowImage: imagePath,
      establishingImage: {
        displayImage: imageUrl,
        workflowImage: imagePath,
        imagePath,
        imageUrl,
      },
      angleImages: {},
    });

    return noStore({
      ok: true,
      background,
      imagePath,
      imageUrl,
      items: listBackgrounds(owner.ownerKey),
    }, { status: 201 });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    return noStore({ ok: false, error: error?.message || "Upload background failed." }, { status: 500 });
  }
}
