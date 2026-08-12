import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_ROOT =
  process.env.OTG_DATA_DIR ||
  process.env.OTG_DATA_ROOT ||
  path.join(process.cwd(), "data");

const ROOT = path.join(
  DATA_ROOT,
  "characters",
  "saved-for-later",
);

const CHARACTER_DEVICE_COOKIE =
  "otg_character_device_id";

type SavedCharacterRecord = {
  id: string;
  filename: string;
  contentType: string;
  createdAt: string;
  promptId: string;
  seed: number;
  backend: string;
  modelLabel: string;
  styleLabel: string;
  mode: "standard" | "freeform";
  description: string;
};

function sanitizeDeviceId(value: unknown) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 96);
}

function deviceIdForRequest(
  request: NextRequest,
) {
  return (
    sanitizeDeviceId(
      request.headers.get("x-otg-device-id"),
    ) ||
    sanitizeDeviceId(
      request.cookies.get(
        CHARACTER_DEVICE_COOKIE,
      )?.value,
    ) ||
    sanitizeDeviceId(
      request.cookies.get("otg_device_id")?.value,
    ) ||
    "character-web"
  );
}

function ownerDir(
  request: NextRequest,
) {
  return path.join(
    ROOT,
    deviceIdForRequest(request),
  );
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, {
    recursive: true,
  });
}

function recordPath(
  dir: string,
  id: string,
) {
  return path.join(
    dir,
    `${id}.json`,
  );
}

function safeRecordId(value: unknown) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 160);
}

function extensionFor(
  type: string,
) {
  switch (
    String(type || "").toLowerCase()
  ) {
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    default:
      return ".png";
  }
}

function imageUrl(
  id: string,
) {
  return (
    "/api/characters/saved-for-later" +
    `?id=${encodeURIComponent(id)}&image=1`
  );
}

function readRecord(
  dir: string,
  id: string,
): SavedCharacterRecord | null {
  const safeId = safeRecordId(id);

  if (!safeId) return null;

  const target = recordPath(
    dir,
    safeId,
  );

  if (!fs.existsSync(target)) {
    return null;
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        target,
        "utf8",
      ),
    ) as SavedCharacterRecord;
  } catch {
    return null;
  }
}

function withDeviceCookie(
  response: NextResponse,
  request: NextRequest,
) {
  response.cookies.set(
    CHARACTER_DEVICE_COOKIE,
    deviceIdForRequest(request),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    },
  );

  return response;
}

function jsonResponse(
  request: NextRequest,
  body: Record<string, unknown>,
  status = 200,
) {
  return withDeviceCookie(
    NextResponse.json(
      body,
      {
        status,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    ),
    request,
  );
}

export async function GET(
  request: NextRequest,
) {
  const dir = ownerDir(request);

  const id = safeRecordId(
    request.nextUrl.searchParams.get("id"),
  );

  if (
    id &&
    request.nextUrl.searchParams.get("image") === "1"
  ) {
    const record = readRecord(
      dir,
      id,
    );

    if (!record) {
      return jsonResponse(
        request,
        {
          ok: false,
          error:
            "Saved Character image not found.",
        },
        404,
      );
    }

    const file = path.join(
      dir,
      path.basename(record.filename),
    );

    if (!fs.existsSync(file)) {
      return jsonResponse(
        request,
        {
          ok: false,
          error:
            "Saved Character image file is missing.",
        },
        404,
      );
    }

    return withDeviceCookie(
      new NextResponse(
        new Uint8Array(
          fs.readFileSync(file),
        ),
        {
          headers: {
            "Content-Type":
              record.contentType ||
              "image/png",
            "Cache-Control":
              "private, no-store",
          },
        },
      ),
      request,
    );
  }

  if (!fs.existsSync(dir)) {
    return jsonResponse(
      request,
      {
        ok: true,
        items: [],
      },
    );
  }

  const items = fs
    .readdirSync(dir)
    .filter(
      (name) =>
        name.endsWith(".json"),
    )
    .map((name) => {
      try {
        const record = JSON.parse(
          fs.readFileSync(
            path.join(dir, name),
            "utf8",
          ),
        ) as SavedCharacterRecord;

        return {
          ...record,
          imageUrl:
            imageUrl(record.id),
        };
      } catch {
        return null;
      }
    })
    .filter(
      (
        item,
      ): item is SavedCharacterRecord & {
        imageUrl: string;
      } => !!item,
    )
    .sort(
      (a, b) =>
        String(b.createdAt)
          .localeCompare(
            String(a.createdAt),
          ),
    );

  return jsonResponse(
    request,
    {
      ok: true,
      items,
    },
  );
}

export async function POST(
  request: NextRequest,
) {
  const dir = ownerDir(request);

  ensureDir(dir);

  const form =
    await request.formData();

  const image =
    form.get("image");

  if (!(image instanceof File)) {
    return jsonResponse(
      request,
      {
        ok: false,
        error:
          "Saved Character image is required.",
      },
      400,
    );
  }

  const contentType =
    image.type || "image/png";

  if (
    !String(contentType)
      .toLowerCase()
      .startsWith("image/")
  ) {
    return jsonResponse(
      request,
      {
        ok: false,
        error:
          "Saved Character file must be an image.",
      },
      400,
    );
  }

  const mode =
    String(
      form.get("mode") || "",
    ) === "freeform"
      ? "freeform"
      : "standard";

  const id =
    `${Date.now()}-${randomUUID()}`;

  const filename =
    `${id}${extensionFor(contentType)}`;

  fs.writeFileSync(
    path.join(
      dir,
      filename,
    ),
    new Uint8Array(
      await image.arrayBuffer(),
    ),
  );

  const record: SavedCharacterRecord = {
    id,
    filename,
    contentType,
    createdAt:
      new Date().toISOString(),
    promptId: String(
      form.get("promptId") || "",
    ),
    seed: Number(
      form.get("seed") || 0,
    ),
    backend: String(
      form.get("backend") || "",
    ),
    modelLabel: String(
      form.get("modelLabel") || "",
    ),
    styleLabel: String(
      form.get("styleLabel") || "",
    ),
    mode,
    description: String(
      form.get("description") || "",
    ),
  };

  fs.writeFileSync(
    recordPath(
      dir,
      id,
    ),
    JSON.stringify(
      record,
      null,
      2,
    ),
  );

  return jsonResponse(
    request,
    {
      ok: true,
      item: {
        ...record,
        imageUrl:
          imageUrl(id),
      },
    },
  );
}
