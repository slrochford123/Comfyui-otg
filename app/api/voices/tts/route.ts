// Convenience wrapper: UI calls /api/voices/tts, backend implementation lives in /api/voices/create.

export { POST } from "../create/route";

export const dynamic = "force-dynamic";
export const revalidate = 0;
