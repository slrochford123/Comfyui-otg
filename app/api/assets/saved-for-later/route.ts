import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  NextRequest,
  NextResponse,
} from "next/server";
import sharp from "sharp";

import {
  getOwnerContext,
  SessionInvalidError,
} from "@/lib/ownerKey";
import {
  OTG_DATA_ROOT,
  ensureDir,
  safeJoin,
  safeSegment,
} from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SOURCE_BYTES =
  25 * 1024 * 1024;

type SavedAssetCandidate = {
  type: "asset-saved-for-later";
  id: string;
  name: string;
  imageUrl: string;
  serverPath: string;
  source: string;
  modelId: string;
  modelLabel: string;
  artStyle: string;
  prompt: string;
  promptId: string;
  seed: number;
  workflowId: string;
  internalPrompt: string;
  sourceCandidateId: string;
  rootCandidateId: string;
  editDepth: number;
  editInstruction: string;
  backgroundFree: boolean;
  createdAt: string;
  updatedAt: string;
};

function noStore(
  payload: unknown,
  init?: ResponseInit,
) {
  return NextResponse.json(
    payload,
    {
      ...init,
      headers: {
        "Cache-Control":
          "private, no-store",
        ...(init?.headers || {}),
      },
    },
  );
}

function clean(
  value: unknown,
) {
  return String(
    value ?? "",
  ).trim();
}

function cleanBoolean(
  value: unknown,
) {
  const raw =
    clean(value).toLowerCase();

  return [
    "true",
    "1",
    "yes",
    "on",
  ].includes(raw);
}

function rootForOwner(
  ownerKey: string,
) {
  return safeJoin(
    path.join(
      OTG_DATA_ROOT,
      "assets-saved-for-later",
    ),
    safeSegment(
      ownerKey || "local",
    ),
  );
}

function jsonFile(
  ownerKey: string,
  id: string,
) {
  return safeJoin(
    rootForOwner(ownerKey),
    `${safeSegment(id)}.json`,
  );
}

function imageFile(
  ownerKey: string,
  id: string,
) {
  return safeJoin(
    rootForOwner(ownerKey),
    `${safeSegment(id)}.png`,
  );
}

function readRecord(
  filePath: string,
): SavedAssetCandidate | null {
  try {
    const value =
      JSON.parse(
        fs.readFileSync(
          filePath,
          "utf8",
        ),
      );

    return (
      value?.type ===
        "asset-saved-for-later" &&
      value?.id
    )
      ? value
      : null;
  } catch {
    return null;
  }
}

function listSaved(
  ownerKey: string,
) {
  const root =
    rootForOwner(ownerKey);

  if (!fs.existsSync(root)) {
    return [];
  }

  return fs
    .readdirSync(
      root,
      {
        withFileTypes:
          true,
      },
    )
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(
          ".json",
        ),
    )
    .map(
      (entry) =>
        readRecord(
          safeJoin(
            root,
            entry.name,
          ),
        ),
    )
    .filter(
      (
        item,
      ): item is SavedAssetCandidate =>
        Boolean(item),
    )
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(
          left.updatedAt,
        ),
    );
}

function writeJsonAtomic(
  filePath: string,
  value: unknown,
) {
  ensureDir(
    path.dirname(filePath),
  );

  const temp =
    `${filePath}.${process.pid}.${Date.now()}.tmp`;

  fs.writeFileSync(
    temp,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );

  fs.renameSync(
    temp,
    filePath,
  );
}

function failure(
  error: unknown,
) {
  if (
    error instanceof
    SessionInvalidError
  ) {
    return noStore(
      {
        ok: false,
        error:
          "Unauthorized",
      },
      {
        status: 401,
      },
    );
  }

  return noStore(
    {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Saved Asset request failed.",
    },
    {
      status: 500,
    },
  );
}

export async function GET(
  request: NextRequest,
) {
  try {
    const {
      ownerKey,
    } =
      await getOwnerContext(
        request,
      );

    return noStore({
      ok: true,
      items:
        listSaved(
          ownerKey,
        ),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(
  request: NextRequest,
) {
  try {
    const bodyRequest =
      request.clone();

    const {
      ownerKey,
    } =
      await getOwnerContext(
        request,
      );

    const form =
      await bodyRequest.formData();

    const image =
      form.get("image");

    if (
      !(image instanceof File)
    ) {
      return noStore(
        {
          ok: false,
          error:
            "Save for Later requires an Asset image.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      image.size <= 0
    ) {
      return noStore(
        {
          ok: false,
          error:
            "Asset image is empty.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      image.size >
      MAX_SOURCE_BYTES
    ) {
      return noStore(
        {
          ok: false,
          error:
            "Asset image exceeds the 25 MB Save for Later limit.",
        },
        {
          status: 413,
        },
      );
    }

    if (
      image.type &&
      !/^image\//i.test(
        image.type,
      )
    ) {
      return noStore(
        {
          ok: false,
          error:
            "Save for Later requires an image file.",
        },
        {
          status: 415,
        },
      );
    }

    const name =
      clean(
        form.get(
          "assetName",
        ),
      ) ||
      "Untitled Asset";

    const id =
      `asset-later-${crypto.randomUUID()}`;

    const root =
      rootForOwner(
        ownerKey,
      );

    ensureDir(root);

    const targetImage =
      imageFile(
        ownerKey,
        id,
      );

    const sourceBytes =
      Buffer.from(
        await image.arrayBuffer(),
      );

    const normalized =
      await sharp(
        sourceBytes,
        {
          animated: false,
          failOn: "error",
        },
      )
        .rotate()
        .png({
          compressionLevel: 6,
          adaptiveFiltering:
            true,
        })
        .toBuffer();

    fs.writeFileSync(
      targetImage,
      normalized,
    );

    const now =
      new Date().toISOString();

    const record:
      SavedAssetCandidate = {
      type:
        "asset-saved-for-later",
      id,
      name:
        name.slice(
          0,
          120,
        ),
      imageUrl:
        `/api/file?path=${encodeURIComponent(targetImage)}`,
      serverPath:
        targetImage,
      source:
        clean(
          form.get(
            "source",
          ),
        ),
      modelId:
        clean(
          form.get(
            "modelId",
          ),
        ),
      modelLabel:
        clean(
          form.get(
            "modelLabel",
          ),
        ),
      artStyle:
        clean(
          form.get(
            "artStyle",
          ),
        ),
      prompt:
        clean(
          form.get(
            "prompt",
          ),
        ),
      promptId:
        clean(
          form.get(
            "promptId",
          ),
        ),
      seed:
        Number(
          form.get(
            "seed",
          ),
        ) || 0,
      workflowId:
        clean(
          form.get(
            "workflowId",
          ),
        ),
      internalPrompt:
        clean(
          form.get(
            "internalPrompt",
          ),
        ),
      sourceCandidateId:
        clean(
          form.get(
            "sourceCandidateId",
          ),
        ),
      rootCandidateId:
        clean(
          form.get(
            "rootCandidateId",
          ),
        ),
      editDepth:
        Number(
          form.get(
            "editDepth",
          ),
        ) || 0,
      editInstruction:
        clean(
          form.get(
            "editInstruction",
          ),
        ),
      backgroundFree:
        cleanBoolean(
          form.get(
            "backgroundFree",
          ),
        ),
      createdAt: now,
      updatedAt: now,
    };

    writeJsonAtomic(
      jsonFile(
        ownerKey,
        id,
      ),
      record,
    );

    return noStore(
      {
        ok: true,
        item: record,
        items:
          listSaved(
            ownerKey,
          ),
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(
  request: NextRequest,
) {
  try {
    const {
      ownerKey,
    } =
      await getOwnerContext(
        request,
      );

    const id =
      clean(
        request.nextUrl.searchParams.get(
          "id",
        ),
      );

    if (!id) {
      return noStore(
        {
          ok: false,
          error:
            "id is required.",
        },
        {
          status: 400,
        },
      );
    }

    const recordPath =
      jsonFile(
        ownerKey,
        id,
      );

    const candidateImage =
      imageFile(
        ownerKey,
        id,
      );

    const existed =
      fs.existsSync(
        recordPath,
      ) ||
      fs.existsSync(
        candidateImage,
      );

    if (
      fs.existsSync(
        recordPath,
      )
    ) {
      fs.unlinkSync(
        recordPath,
      );
    }

    if (
      fs.existsSync(
        candidateImage,
      )
    ) {
      fs.unlinkSync(
        candidateImage,
      );
    }

    return noStore({
      ok: true,
      deleted: existed,
      items:
        listSaved(
          ownerKey,
        ),
    });
  } catch (error) {
    return failure(error);
  }
}
