export type CanonicalBackgroundImageAsset = {
  displayImage: string;
  workflowImage: string;
  imagePath?: string;
  imageUrl?: string;
};

type CanonicalBackgroundRecordLike = {
  establishingImage?: unknown;
  panoramaImage?: unknown;
  angleImages?: unknown;
  displayImage?: unknown;
  workflowImage?: unknown;
  imagePath?: unknown;
  imageUrl?: unknown;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normalizeCanonicalBackgroundImageAsset(
  input: unknown,
): CanonicalBackgroundImageAsset | undefined {
  const asset = asRecord(input);
  if (!asset) return undefined;

  const imagePath = cleanText(
    asset.imagePath ||
      asset.path ||
      asset.serverPath,
  );
  const imageUrl = cleanText(
    asset.imageUrl ||
      asset.url ||
      asset.fileUrl ||
      asset.displayImage,
  );
  const workflowImage = cleanText(
    asset.workflowImage ||
      imagePath ||
      imageUrl,
  );
  const displayImage = cleanText(
    asset.displayImage ||
      imageUrl ||
      imagePath ||
      workflowImage,
  );

  if (!displayImage && !workflowImage) return undefined;

  return {
    displayImage: displayImage || workflowImage,
    workflowImage: workflowImage || displayImage,
    imagePath: imagePath || undefined,
    imageUrl: imageUrl || undefined,
  };
}

export function canonicalBackgroundFrontAsset(
  input: CanonicalBackgroundRecordLike | null | undefined,
) {
  const record = asRecord(input);
  const angleImages = asRecord(record?.angleImages);

  return normalizeCanonicalBackgroundImageAsset(angleImages?.front);
}

export function canonicalBackgroundPersistenceFields(
  input: CanonicalBackgroundRecordLike | null | undefined,
) {
  const record = asRecord(input) || {};
  const existingEstablishing = normalizeCanonicalBackgroundImageAsset(
    record.establishingImage,
  );
  const front = canonicalBackgroundFrontAsset(record);
  const establishingImage = existingEstablishing || front;
  const panoramaImage = normalizeCanonicalBackgroundImageAsset(
    record.panoramaImage,
  );

  // OTG_BACKGROUND_CANONICAL_SAVE_FRONT_FALLBACK_V36BPI2
  // A completed six-reference card may be represented solely by angleImages.
  // Promote its canonical Front/Master without changing existing field precedence.
  const displayImage = cleanText(
    establishingImage?.displayImage ||
      record.displayImage ||
      record.imageUrl ||
      record.imagePath ||
      record.workflowImage,
  );
  const workflowImage = cleanText(
    record.workflowImage ||
      establishingImage?.workflowImage ||
      record.imagePath ||
      panoramaImage?.workflowImage ||
      record.imageUrl ||
      displayImage,
  );
  const imagePath = cleanText(
    record.imagePath ||
      establishingImage?.imagePath ||
      workflowImage,
  );
  const imageUrl = cleanText(
    record.imageUrl ||
      establishingImage?.imageUrl ||
      displayImage,
  );

  const normalizedEstablishing =
    establishingImage ||
    normalizeCanonicalBackgroundImageAsset({
      displayImage: displayImage || workflowImage,
      workflowImage: workflowImage || displayImage,
      imagePath,
      imageUrl,
    });

  return {
    displayImage,
    workflowImage,
    imagePath,
    imageUrl,
    establishingImage: normalizedEstablishing,
  };
}
