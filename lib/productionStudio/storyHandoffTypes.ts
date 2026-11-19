/** Approved story memory travels independently of unapproved conversation notes. */
export type StoryLink = {
  version: 1;
  storyId: string;
  title: string;
  episode: string;
  sourceKey: string;
  planVersion: number | null;
  capturedAt: string;
  canon: { id: string; subject: string; predicate: string; value: string }[];
  workingNotes: { id: string; role: string; text: string }[];
  sourceAssets: { sourceId: string; assetId: string; name: string; role: string }[];
};
export type HandoffAsset = { id: string; name: string; kind: "image"|"audio"; role: string; approved: boolean };
export type HandoffPreview = {
  story: {id: string; title: string}; sourceKey: string;
  canon: StoryLink["canon"]; workingNotes: StoryLink["workingNotes"];
  planVersion: number|null; approvedPlan: boolean; targetSeconds: number;
  scenes: number; clips: number; assets: HandoffAsset[];
  productions: {id: string; name: string; episode: string}[];
};
