import fsp from "node:fs/promises";
import path from "node:path";

import {
  ensureDir,
  OTG_DATA_ROOT,
  safeJoin,
  safeSegment,
} from "@/lib/paths";
import {
  isAcceptedH3MediaFile,
  supportedH3MediaExtensions,
  type H3InputMediaKind,
} from "@/lib/h3MediaTypes";

export const MAX_STAGED_H3_UPLOAD_BYTES =
  512 * 1024 * 1024;

export const MAX_STAGED_H3_CHUNK_BYTES =
  10 * 1024 * 1024;

export const H3_STAGED_UPLOAD_TTL_MS =
  24 * 60 * 60 * 1000;

const UPLOAD_ID_PATTERN =
  /^[a-z0-9][a-z0-9_-]{7,79}$/i;

const FALLBACK_EXTENSIONS: Record<H3InputMediaKind, string> = {
  image: ".png",
  video: ".mp4",
  audio: ".wav",
};

export type StagedH3Upload = {
  id: string;
  kind: H3InputMediaKind;
  name: string;
  type: string;
  size: number;
  path: string;
  complete: true;
};

export type StagedH3UploadDescriptor = {
  id: string;
  kind: H3InputMediaKind;
  name: string;
  type: string;
  size: number;
};

type StagedH3UploadMeta =
  StagedH3UploadDescriptor & {
    chunkCount: number;
    complete: boolean;
    completedAt: string | null;
  };

export function isH3InputMediaKind(
  value: string,
): value is H3InputMediaKind {
  return value === "image" || value === "video" || value === "audio";
}

export function sanitizeH3StagedUploadId(
  value: unknown,
) {
  const id =
    String(
      value || "",
    ).trim();

  if (
    !UPLOAD_ID_PATTERN.test(
      id,
    )
  ) {
    throw new Error(
      "Invalid H3 upload id.",
    );
  }

  return id;
}

export function safeH3StagedUploadName(
  value: unknown,
  kind: H3InputMediaKind,
) {
  const fallback =
    `h3-reference${FALLBACK_EXTENSIONS[kind]}`;

  const raw =
    path
      .basename(
        String(
          value || fallback,
        ).replace(
          /[\r\n]/g,
          "",
        ),
      )
    || fallback;

  const rawExtension =
    path.extname(
      raw,
    );

  const extension =
    rawExtension
      .toLowerCase()
    || FALLBACK_EXTENSIONS[kind];

  const stem =
    path
      .basename(
        raw,
        rawExtension,
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
    || "h3-reference";

  return `${stem}${extension}`;
}

export function h3StagedUploadRoot(
  ownerKey: string,
) {
  const root =
    path.join(
      OTG_DATA_ROOT,
      "h3-direct",
      safeSegment(
        ownerKey,
      ),
      "staged",
    );

  ensureDir(
    root,
  );

  return root;
}

export function readStagedH3UploadDescriptor(
  value: unknown,
): StagedH3UploadDescriptor {
  const record =
    value && typeof value === "object"
      ? value as Record<string, unknown>
      : {};

  const kind =
    String(
      record.kind || "",
    ).trim();

  if (
    !isH3InputMediaKind(
      kind,
    )
  ) {
    throw new Error(
      "Choose a supported H3 media category.",
    );
  }

  const id =
    sanitizeH3StagedUploadId(
      record.id,
    );

  const name =
    safeH3StagedUploadName(
      record.name,
      kind,
    );

  const type =
    String(
      record.type || "",
    )
      .split(
        ";",
        1,
      )[0]
      .trim()
      .toLowerCase();

  const size =
    Number(
      record.size,
    );

  if (
    !Number.isSafeInteger(
      size,
    )
    || size <= 0
  ) {
    throw new Error(
      "H3 upload is empty.",
    );
  }

  if (
    size
    > MAX_STAGED_H3_UPLOAD_BYTES
  ) {
    throw new Error(
      "H3 upload is larger than 512 MB.",
    );
  }

  if (
    !isAcceptedH3MediaFile(
      kind,
      {
        name,
        type,
      },
    )
  ) {
    throw new Error(
      `Choose a supported H3 ${kind} file (${supportedH3MediaExtensions(kind).join(", ")}).`,
    );
  }

  return {
    id,
    kind,
    name,
    type,
    size,
  };
}

export function stagedH3UploadPaths(
  ownerKey: string,
  descriptor: Pick<StagedH3UploadDescriptor, "id" | "name">,
) {
  const root =
    h3StagedUploadRoot(
      ownerKey,
    );

  const directory =
    safeJoin(
      root,
      descriptor.id,
    );

  const chunks =
    safeJoin(
      directory,
      "chunks",
    );

  return {
    root,
    directory,
    chunks,
    metaPath:
      safeJoin(
        directory,
        "upload.json",
      ),
    targetPath:
      safeJoin(
        directory,
        descriptor.name,
      ),
  };
}

export async function pruneExpiredH3StagedUploads(
  ownerKey: string,
) {
  const root =
    h3StagedUploadRoot(
      ownerKey,
    );

  const cutoff =
    Date.now()
    - H3_STAGED_UPLOAD_TTL_MS;

  const entries =
    await fsp.readdir(
      root,
      {
        withFileTypes: true,
      },
    )
      .catch(
        () => [],
      );

  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory(),
      )
      .map(
        async (entry) => {
          const directory =
            safeJoin(
              root,
              entry.name,
            );

          try {
            const stat =
              await fsp.stat(
                directory,
              );

            if (
              stat.mtimeMs
              < cutoff
            ) {
              await fsp.rm(
                directory,
                {
                  recursive: true,
                  force: true,
                },
              );
            }
          } catch {
            // Best-effort cleanup only.
          }
        },
      ),
  );
}

export async function readCompletedH3StagedUpload(
  ownerKey: string,
  value: unknown,
  expectedKind: H3InputMediaKind,
): Promise<StagedH3Upload> {
  const descriptor =
    readStagedH3UploadDescriptor(
      value,
    );

  if (
    descriptor.kind
    !== expectedKind
  ) {
    throw new Error(
      `Expected a staged H3 ${expectedKind} upload.`,
    );
  }

  const paths =
    stagedH3UploadPaths(
      ownerKey,
      descriptor,
    );

  const meta =
    JSON.parse(
      await fsp.readFile(
        paths.metaPath,
        "utf8",
      ),
    ) as StagedH3UploadMeta;

  if (
    meta.id !== descriptor.id
    || meta.kind !== descriptor.kind
    || meta.name !== descriptor.name
    || meta.size !== descriptor.size
    || meta.complete !== true
  ) {
    throw new Error(
      "H3 upload is incomplete.",
    );
  }

  const stat =
    await fsp.stat(
      paths.targetPath,
    );

  if (
    !stat.isFile()
    || stat.size !== descriptor.size
  ) {
    throw new Error(
      "H3 upload is incomplete.",
    );
  }

  return {
    ...descriptor,
    path:
      paths.targetPath,
    complete: true,
  };
}
