// Spatial descriptions are SAM3 queries, not reliable numeric ordinals.
export function scailSourceObjectIndex(selector: string) {
  if (/\bthird\b|\b3rd\b/i.test(selector)) return "2";
  if (/\bsecond\b|\b2nd\b/i.test(selector)) return "1";
  return "0";
}
export function scailFramePlan(seconds: number) {
  const fps=24;
  const outputFrames=Math.round(seconds*fps);
  return {fps,outputFrames,conditioningFrames:Math.ceil((outputFrames-1)/4)*4+1};
}
