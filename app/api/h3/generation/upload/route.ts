import fsp from "node:fs/promises";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  MAX_STAGED_H3_CHUNK_BYTES,
  pruneExpiredH3StagedUploads,
  readStagedH3UploadDescriptor,
  stagedH3UploadPaths,
} from "@/lib/h3StagedUploads";
import {
  getOwnerContext,
  SessionInvalidError,
} from "@/lib/ownerKey";
import {
  ensureDir,
  safeJoin,
} from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_STAGED_H3_CHUNKS =
  128;

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

function readInteger(
  value: unknown,
  label: string,
) {
  const parsed =
    Number(
      value,
    );

  if (
    !Number.isSafeInteger(
      parsed,
    )
  ) {
    throw new Error(
      `Invalid ${label}.`,
    );
  }

  return parsed;
}

async function allChunksPresent(
  chunksDir: string,
  chunkCount: number,
) {
  for (
    let index = 0;
    index < chunkCount;
    index += 1
  ) {
    const chunkPath =
      safeJoin(
        chunksDir,
        `${index}.part`,
      );

    const stat =
      await fsp.stat(
        chunkPath,
      )
        .catch(
          () => null,
        );

    if (
      !stat?.isFile()
    ) {
      return false;
    }
  }

  return true;
}

async function assembleChunks(
  paths: ReturnType<typeof stagedH3UploadPaths>,
  chunkCount: number,
  expectedSize: number,
) {
  const tempPath =
    safeJoin(
      paths.directory,
      "upload.tmp",
    );

  await fsp.rm(
    tempPath,
    {
      force: true,
    },
  );

  const handle =
    await fsp.open(
      tempPath,
      "w",
    );

  let assembledBytes =
    0;

  try {
    for (
      let index = 0;
      index < chunkCount;
      index += 1
    ) {
      const chunkPath =
        safeJoin(
          paths.chunks,
          `${index}.part`,
        );

      const chunk =
        await fsp.readFile(
          chunkPath,
        );

      assembledBytes +=
        chunk.byteLength;

      await handle.write(
        chunk,
      );
    }
  } finally {
    await handle.close();
  }

  if (
    assembledBytes
    !== expectedSize
  ) {
    await fsp.rm(
      tempPath,
      {
        force: true,
      },
    );

    throw new Error(
      "H3 upload size changed before it finished.",
    );
  }

  await fsp.rename(
    tempPath,
    paths.targetPath,
  );
}

function errorResponse(
  error: unknown,
) {
  if (
    error
    instanceof SessionInvalidError
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
          : "H3 upload failed.",
    },
    {
      status: 400,
    },
  );
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

    const descriptor =
      readStagedH3UploadDescriptor(
        {
          id:
            form.get(
              "uploadId",
            ),
          kind:
            form.get(
              "kind",
            ),
          name:
            form.get(
              "name",
            ),
          type:
            form.get(
              "type",
            ),
          size:
            form.get(
              "size",
            ),
        },
      );

    const chunkIndex =
      readInteger(
        form.get(
          "chunkIndex",
        ),
        "chunk index",
      );

    const chunkCount =
      readInteger(
        form.get(
          "chunkCount",
        ),
        "chunk count",
      );

    if (
      chunkCount < 1
      || chunkCount > MAX_STAGED_H3_CHUNKS
      || chunkIndex < 0
      || chunkIndex >= chunkCount
    ) {
      throw new Error(
        "Invalid H3 upload chunk.",
      );
    }

    const chunk =
      form.get(
        "chunk",
      );

    if (
      !(chunk instanceof File)
      || chunk.size <= 0
    ) {
      throw new Error(
        "Missing H3 upload chunk.",
      );
    }

    if (
      chunk.size
      > MAX_STAGED_H3_CHUNK_BYTES
    ) {
      throw new Error(
        "H3 upload chunk is too large.",
      );
    }

    await pruneExpiredH3StagedUploads(
      owner.ownerKey,
    );

    const paths =
      stagedH3UploadPaths(
        owner.ownerKey,
        descriptor,
      );

    ensureDir(
      paths.directory,
    );

    ensureDir(
      paths.chunks,
    );

    const chunkPath =
      safeJoin(
        paths.chunks,
        `${chunkIndex}.part`,
      );

    await fsp.writeFile(
      chunkPath,
      Buffer.from(
        await chunk.arrayBuffer(),
      ),
    );

    const complete =
      await allChunksPresent(
        paths.chunks,
        chunkCount,
      );

    if (
      complete
    ) {
      await assembleChunks(
        paths,
        chunkCount,
        descriptor.size,
      );

      await fsp.writeFile(
        paths.metaPath,
        JSON.stringify(
          {
            ...descriptor,
            chunkCount,
            complete: true,
            completedAt:
              new Date()
                .toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      );

      await fsp.rm(
        paths.chunks,
        {
          recursive: true,
          force: true,
        },
      );
    }

    return noStore(
      {
        ok: true,
        upload: {
          ...descriptor,
          complete,
        },
      },
    );
  } catch (error) {
    return errorResponse(
      error,
    );
  }
}
