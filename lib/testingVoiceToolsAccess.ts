import {changeVoiceEnabled} from "@/lib/h3CharacterDevelopmentAvailability";
import { RequestError } from "@/lib/requestError";
import { requireSessionUser } from "@/lib/sessionUser";

export async function requireTestingVoiceTools(request: Request) {
  if (!changeVoiceEnabled()) throw new RequestError("Not found.", 404);
  if (!(await requireSessionUser(request)).admin) throw new RequestError("Voice correction requires administrator access.", 403);
}
