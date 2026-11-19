import {RequestError} from "@/lib/requestError";
/** Deployment switches only; HTTP routes retain existing administrator authorization. */
export function characterDevelopmentEnabled(environment=process.env.OTG_ENV) {
 return environment==="test" || environment==="prod" && process.env.OTG_H3_CHARACTER_DEVELOPMENT_ENABLED==="1";
}
export function requireCharacterDevelopment(){if(!characterDevelopmentEnabled())throw new RequestError("Not found.",404);}
export function changeVoiceEnabled(){return process.env.OTG_ENV==="test" || process.env.OTG_ENV==="prod" && process.env.OTG_H3_CHANGE_VOICE_ENABLED==="1";}
