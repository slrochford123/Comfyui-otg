import {
  NextRequest,
  NextResponse,
} from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import {
  getOwnerContext,
  SessionInvalidError,
} from "@/lib/ownerKey";
import {
  OTG_DATA_ROOT,
  ensureDir,
  safeSegment,
} from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES =
  25 * 1024 * 1024;

const IMAGE_EXTENSIONS =
  new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
  ]);

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

function safeImageExt(
  file: File,
) {
  const ext = path
    .extname(
      file.name || "",
    )
    .toLowerCase();

  const mime = String(
    file.type || "",
  ).toLowerCase();

  if (
    IMAGE_EXTENSIONS.has(
      ext,
    ) &&
    (
      !mime ||
      mime.startsWith(
        "image/",
      )
    )
  ) {
    return ext;
  }

  if (
    mime === "image/png"
  ) {
    return ".png";
  }

  if (
    mime === "image/jpeg"
  ) {
    return ".jpg";
  }

  if (
    mime === "image/webp"
  ) {
    return ".webp";
  }

  if (
    mime === "image/gif"
  ) {
    return ".gif";
  }

  return "";
}

export async function POST(
  req: NextRequest,
) {
  try {
    const {
      ownerKey,
    } =
      await getOwnerContext(
        req,
      );

    const form =
      await req.formData();

    const file =
      form.get("image");

    if (
      !(file instanceof File)
    ) {
      return noStore(
        {
          ok: false,
          error:
            "Missing Asset image file.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      file.size <= 0
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
      file.size >
      MAX_IMAGE_BYTES
    ) {
      return noStore(
        {
          ok: false,
          error:
            "Asset image exceeds the 25 MB upload limit.",
        },
        {
          status: 413,
        },
      );
    }

    const ext =
      safeImageExt(file);

    if (!ext) {
      return noStore(
        {
          ok: false,
          error:
            "Unsupported Asset image type. Use PNG, JPEG, WEBP, or GIF.",
        },
        {
          status: 400,
        },
      );
    }

    const requestedName =
      String(
        form.get("assetName") ||
          "asset",
      ).trim();

    const safeName =
      safeSegment(
        requestedName ||
          "asset",
      );

    const ownerDir =
      path.join(
        OTG_DATA_ROOT,
        "uploads",
        "assets",
        safeSegment(
          ownerKey,
        ),
      );

    ensureDir(ownerDir);

    const id =
      crypto.randomUUID();

    const filename =
      `${safeName}_${id}${ext}`;

    const abs =
      path.join(
        ownerDir,
        filename,
      );

    const bytes =
      Buffer.from(
        await file.arrayBuffer(),
      );

    await fs.writeFile(
      abs,
      bytes,
    );

    return noStore(
      {
        ok: true,
        serverPath: abs,
        filename,
        fileUrl:
          `/api/file?path=${encodeURIComponent(abs)}`,
        assetName:
          requestedName ||
          safeName,
        bytes:
          bytes.length,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
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
            : "Asset upload failed.",
      },
      {
        status: 500,
      },
    );
  }
}
