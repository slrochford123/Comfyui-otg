export type H3CreativeDirectionInput = {
  stylePresetId?: unknown;
  visualStyle?: unknown;
  cameraFeel?: unknown;
  shotFlow?: unknown;
};

export type H3CreativeDirection = {
  stylePresetId: string;
  visualStyle: string;
  cameraFeel: string;
  shotFlow: string;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeH3CreativeDirection(
  input: H3CreativeDirectionInput | null | undefined,
): H3CreativeDirection {
  return {
    stylePresetId: clean(input?.stylePresetId) || "none",
    visualStyle: clean(input?.visualStyle),
    cameraFeel: clean(input?.cameraFeel),
    shotFlow: clean(input?.shotFlow),
  };
}

export function h3CreativeDirectionLines(
  input: H3CreativeDirectionInput | null | undefined,
) {
  const creative = normalizeH3CreativeDirection(input);
  const lines = [
    creative.visualStyle ? `Visual style: ${creative.visualStyle}.` : "",
    creative.cameraFeel ? `Camera feel: ${creative.cameraFeel}.` : "",
    creative.shotFlow
      ? `Shot flow / motion direction: ${creative.shotFlow}.`
      : "",
  ].filter(Boolean);

  return lines.length
    ? lines.join("\n")
    : "Use a neutral cinematic H3 look unless the user prompt says otherwise.";
}
