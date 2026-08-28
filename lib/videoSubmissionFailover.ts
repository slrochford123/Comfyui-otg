export type VideoSubmissionFallbackDecisionInput = {
  routeKind: string;
  selectionOk: boolean;
  backendId: string | null;
  hasFallbackRequestClone: boolean;
  upstreamStatus: number;
};

/**
 * Cross-GPU replay is only valid after a definite server-side primary rejection.
 * Client/workflow 4xx responses are deterministic request failures and must be
 * returned unchanged instead of being masked by fallback availability.
 */
export function shouldAttemptVideoSubmissionFallback(
  input: VideoSubmissionFallbackDecisionInput,
): boolean {
  const retryablePrimaryRejection =
    Number.isInteger(input.upstreamStatus) &&
    input.upstreamStatus >= 500 &&
    input.upstreamStatus <= 599;

  return (
    input.routeKind === "video" &&
    input.selectionOk &&
    input.backendId === "rtx3090" &&
    input.hasFallbackRequestClone &&
    retryablePrimaryRejection
  );
}
