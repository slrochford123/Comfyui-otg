// Compatibility alias: older clients called /api/comfy/create
// Forward to the main /api/comfy handler.
export { POST } from "../route";
export const dynamic = "force-dynamic";
