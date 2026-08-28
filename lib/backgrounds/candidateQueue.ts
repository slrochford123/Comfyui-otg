export type TemporaryBackgroundCandidate = {
  id: string;
  sourceType?: "generated" | "uploaded";
};

export function appendGeneratedBackgroundCandidateFifo<T extends TemporaryBackgroundCandidate>(
  current: T[],
  next: T,
  maximum = 5,
) {
  const limit = Math.max(1, Math.floor(maximum));
  const uploaded = current.filter((candidate) => candidate.sourceType === "uploaded");
  const generated = current.filter((candidate) => candidate.sourceType !== "uploaded" && candidate.id !== next.id);
  return [...uploaded, ...generated.slice(-(limit - 1)), { ...next, sourceType: "generated" as const }];
}

export function upsertUploadedBackgroundCandidate<T extends TemporaryBackgroundCandidate>(current: T[], next: T) {
  return [
    ...current.filter((candidate) => candidate.sourceType !== "uploaded" && candidate.id !== next.id),
    { ...next, sourceType: "uploaded" as const },
  ];
}

export function replaceBackgroundCandidate<T extends TemporaryBackgroundCandidate>(current: T[], replacedId: string, next: T) {
  return current.map((candidate) => candidate.id === replacedId ? next : candidate);
}
