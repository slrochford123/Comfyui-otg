export const MAX_ASSET_CANDIDATES = 5;

/**
 * Asset candidate slots are intentionally not a rolling newest-five list.
 *
 * Slots 1 through 4 become stable once filled.
 * Slot 5 is the replaceable generation slot.
 * Candidate 6 and every later candidate replaces only slot 5.
 */
export function replaceAssetCandidateSlotFive<T>(
  current: readonly T[],
  nextCandidate: T,
): T[] {
  return [
    ...current.slice(0, 4),
    nextCandidate,
  ];
}

export function appendAssetCandidate<T>(
  current: readonly T[],
  candidate: T,
): T[] {
  if (current.length < MAX_ASSET_CANDIDATES) {
    return [...current, candidate];
  }

  return replaceAssetCandidateSlotFive(
    current,
    candidate,
  );
}

export function removeAssetCandidate<
  T extends { id: string },
>(
  current: readonly T[],
  candidateId: string,
): T[] {
  return current
    .filter(
      (candidate) =>
        candidate.id !== candidateId,
    )
    .slice(0, MAX_ASSET_CANDIDATES);
}
