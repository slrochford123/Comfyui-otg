export const ANGLES_WORKFLOW_HORIZONTAL_MIN = 0;
export const ANGLES_WORKFLOW_HORIZONTAL_MAX = 360;
export const ANGLES_WORKFLOW_VERTICAL_MIN = -30;
export const ANGLES_WORKFLOW_VERTICAL_MAX = 60;
export const ANGLES_WORKFLOW_ZOOM_MIN = 0;
export const ANGLES_WORKFLOW_ZOOM_MAX = 10;
export const ANGLES_WORKFLOW_ZOOM_CENTER = 5;

function finiteNumber(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeAnglesWorkflowHorizontal(value: unknown) {
  const rounded = Math.round(finiteNumber(value, 0));
  return ((rounded % 360) + 360) % 360;
}

export function clampAnglesWorkflowVertical(value: unknown) {
  const rounded = Math.round(finiteNumber(value, 0));
  return Math.max(
    ANGLES_WORKFLOW_VERTICAL_MIN,
    Math.min(ANGLES_WORKFLOW_VERTICAL_MAX, rounded)
  );
}

export function clampAnglesWorkflowZoom(value: unknown) {
  const parsed = finiteNumber(value, ANGLES_WORKFLOW_ZOOM_CENTER);
  const clamped = Math.max(
    ANGLES_WORKFLOW_ZOOM_MIN,
    Math.min(ANGLES_WORKFLOW_ZOOM_MAX, parsed)
  );
  return Math.round(clamped * 10) / 10;
}

export function serializeAnglesCamera(
  horizontal: unknown,
  vertical: unknown,
  zoomOffset: unknown
) {
  return {
    horizontal: normalizeAnglesWorkflowHorizontal(horizontal),
    vertical: clampAnglesWorkflowVertical(vertical),
    zoom: clampAnglesWorkflowZoom(
      ANGLES_WORKFLOW_ZOOM_CENTER + finiteNumber(zoomOffset, 0)
    ),
  };
}
