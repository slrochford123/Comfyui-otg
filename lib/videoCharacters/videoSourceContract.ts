export type VideoSourceChoice = {
  key: string;
  name: string;
  clipId: string;
  createdAt: number;
  posterUrl: string;
  infoUrl: string;
  previewUrl: string;
};
export type VideoSourceInfo = { clipId: string; duration: number };

export function videoDurationLabel(seconds: number) {
  const value = Math.max(1, Math.round(seconds));
  return Math.floor(value / 60) + ":" + String(value % 60).padStart(2, "0");
}
