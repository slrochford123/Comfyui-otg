import {
  NextRequest,
  NextResponse,
} from "next/server";

import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

import {
  getOwnerContext,
  SessionInvalidError,
} from "@/lib/ownerKey";

import {
  getOwnerDirs,
  safeJoin,
} from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_SNAPSHOT_BYTES =
  15 * 1024 * 1024;

const SNAPSHOT_TTL_MS =
  60 * 60 * 1000;

const TOKEN_PATTERN =
  /^[a-f0-9]{32}$/;

function safeSnapshotName(
  value: unknown,
) {
  const raw =
    String(
      value || "snapshot.jpg",
    )
      .replace(
        /[\r\n]/g,
        "",
      )
      .split(/[\\/]/)
      .pop()
      || "snapshot.jpg";

  const stem =
    raw
      .replace(
        /\.[^.]+$/,
        "",
      )
      .replace(
        /[^a-zA-Z0-9._-]+/g,
        "-",
      )
      .replace(
        /^[-_.]+|[-_.]+$/g,
        "",
      )
      .slice(
        0,
        120,
      )
    || "snapshot";

  return `${stem}.jpg`;
}

async function snapshotRoot(
  ownerKey: string,
) {
  const ownerDirs =
    getOwnerDirs(
      ownerKey,
    );

  const root =
    path.join(
      ownerDirs.preview,
      "snapshot-downloads",
    );

  await fs.mkdir(
    root,
    {
      recursive: true,
    },
  );

  return root;
}

async function pruneOldSnapshots(
  root: string,
) {
  const entries =
    await fs.readdir(
      root,
      {
        withFileTypes: true,
      },
    )
      .catch(
        () => [],
      );

  const cutoff =
    Date.now()
    - SNAPSHOT_TTL_MS;

  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile()
          && /^[a-f0-9]{32}\.jpg$/.test(
            entry.name,
          ),
      )
      .map(
        async (entry) => {
          const filePath =
            safeJoin(
              root,
              entry.name,
            );

          try {
            const stat =
              await fs.stat(
                filePath,
              );

            if (
              stat.mtimeMs
              < cutoff
            ) {
              await fs.unlink(
                filePath,
              );
            }
          } catch {
            // Best-effort cleanup only.
          }
        },
      ),
  );
}

async function resolveSnapshot(
  request: NextRequest,
) {
  const owner =
    await getOwnerContext(
      request,
    );

  const id =
    String(
      request.nextUrl
        .searchParams
        .get("id")
      || "",
    )
      .trim()
      .toLowerCase();

  if (
    !TOKEN_PATTERN.test(
      id,
    )
  ) {
    return {
      ok: false as const,
      status: 400,
      error:
        "Invalid snapshot download id.",
    };
  }

  const root =
    await snapshotRoot(
      owner.ownerKey,
    );

  const filePath =
    safeJoin(
      root,
      `${id}.jpg`,
    );

  try {
    const stat =
      await fs.stat(
        filePath,
      );

    if (
      !stat.isFile()
    ) {
      throw new Error(
        "not a file",
      );
    }

    return {
      ok: true as const,
      filePath,
      size: stat.size,
      name:
        safeSnapshotName(
          request.nextUrl
            .searchParams
            .get("name"),
        ),
    };
  } catch {
    return {
      ok: false as const,
      status: 404,
      error:
        "Snapshot download expired or was not found.",
    };
  }
}

function downloadHeaders(
  name: string,
  size: number,
) {
  return {
    "Cache-Control":
      "private, no-store, no-cache, must-revalidate",
    "Content-Disposition":
      `attachment; filename="${name}"`,
    "Content-Length":
      String(size),
    "Content-Type":
      "image/jpeg",
    "X-Content-Type-Options":
      "nosniff",
    "X-OTG-Snapshot-Download":
      "owner-scoped-v1",
  };
}

export async function POST(
  request: NextRequest,
) {
  try {
    const owner =
      await getOwnerContext(
        request,
      );

    const form =
      await request.formData();

    const file =
      form.get(
        "snapshot",
      );

    if (
      !(file instanceof File)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Missing snapshot image.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      String(
        file.type || "",
      ).toLowerCase()
      !== "image/jpeg"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Snapshot download must be a JPEG image.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      file.size <= 0
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Snapshot image is empty.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      file.size
      > MAX_SNAPSHOT_BYTES
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Snapshot image is larger than 15 MB.",
        },
        {
          status: 413,
        },
      );
    }

    const root =
      await snapshotRoot(
        owner.ownerKey,
      );

    await pruneOldSnapshots(
      root,
    );

    const id =
      crypto
        .randomBytes(
          16,
        )
        .toString(
          "hex",
        );

    const filePath =
      safeJoin(
        root,
        `${id}.jpg`,
      );

    const bytes =
      Buffer.from(
        await file.arrayBuffer(),
      );

    await fs.writeFile(
      filePath,
      bytes,
      {
        flag: "wx",
      },
    );

    const name =
      safeSnapshotName(
        form.get("name")
        || file.name,
      );

    const downloadUrl =
      `/api/snapshot-download?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`;

    return NextResponse.json(
      {
        ok: true,
        downloadUrl,
        name,
        sizeBytes:
          bytes.length,
      },
      {
        headers: {
          "Cache-Control":
            "no-store",
        },
      },
    );
  } catch (error) {
    if (
      error
      instanceof SessionInvalidError
    ) {
      return NextResponse.json(
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

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not prepare snapshot download.",
      },
      {
        status: 500,
      },
    );
  }
}

export async function GET(
  request: NextRequest,
) {
  try {
    const resolved =
      await resolveSnapshot(
        request,
      );

    if (
      !resolved.ok
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            resolved.error,
        },
        {
          status:
            resolved.status,
        },
      );
    }

    const bytes =
      await fs.readFile(
        resolved.filePath,
      );

    const body =
      new Uint8Array(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );

    return new NextResponse(
      body,
      {
        status: 200,
        headers:
          downloadHeaders(
            resolved.name,
            body.byteLength,
          ),
      },
    );
  } catch (error) {
    if (
      error
      instanceof SessionInvalidError
    ) {
      return NextResponse.json(
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

    return NextResponse.json(
      {
        ok: false,
        error:
          "Snapshot download failed.",
      },
      {
        status: 500,
      },
    );
  }
}

export async function HEAD(
  request: NextRequest,
) {
  try {
    const resolved =
      await resolveSnapshot(
        request,
      );

    if (
      !resolved.ok
    ) {
      return new NextResponse(
        null,
        {
          status:
            resolved.status,
        },
      );
    }

    return new NextResponse(
      null,
      {
        status: 200,
        headers:
          downloadHeaders(
            resolved.name,
            resolved.size,
          ),
      },
    );
  } catch (error) {
    if (
      error
      instanceof SessionInvalidError
    ) {
      return new NextResponse(
        null,
        {
          status: 401,
        },
      );
    }

    return new NextResponse(
      null,
      {
        status: 500,
      },
    );
  }
}
