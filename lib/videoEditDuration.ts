/** Container/audio timing may extend a selected ten-second clip slightly. */
export const VIDEO_EDIT_MAX_SECONDS = 10;
export const VIDEO_EDIT_TIMING_TOLERANCE_SECONDS = 0.3;

export function videoEditDuration(measured: number) {
  if (!Number.isFinite(measured) || measured < 2 || measured > VIDEO_EDIT_MAX_SECONDS + VIDEO_EDIT_TIMING_TOLERANCE_SECONDS) {
    throw new Error("Trim the video to between 2 and 10 seconds.");
  }
  return Math.min(VIDEO_EDIT_MAX_SECONDS, measured);
}
