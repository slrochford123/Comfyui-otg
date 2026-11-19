import type { H3RefModSlot } from "@/lib/h3SpecialModes/refMods";

export const H3_CONTINUATION_MODES = ["h3-text-to-video", "h3-image-to-video", "h3-reference-to-video"] as const;
export const H3_CONTINUATION_ENDPOINT = "/api/h3/continue-scene";

export type H3ContinuationSource = {
  jobId: string;
  mode: string;
  prompt: string;
  stylePresetId: string;
  orientation: "landscape" | "portrait";
  directorConversationId?: string;
  directorSynopsis?: string;
  refMods?: H3RefModSlot[];
};

export type H3ContinuationReview = {
  id: string;
  workspaceId: string;
  source: H3ContinuationSource;
  sourceSha256: string;
  characters: Array<{
    candidateId: string;
    name: string;
    description: string;
    images: string[];
    voice: { id: string; name: string; file: string } | null;
  }>;
  firstFrame?: string;
  includeVideo: boolean;
  refMods?: H3RefModSlot[];
  cardWarnings: string[];
};

export function continuationMediaUrl(workspaceId: string, file: string) {
  return H3_CONTINUATION_ENDPOINT + "?" + new URLSearchParams({workspaceId, file});
}
