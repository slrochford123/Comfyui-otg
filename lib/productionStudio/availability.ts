export function productionStudioEnabled() {
  if(process.env.OTG_ENV==="test")return process.env.OTG_PRODUCTION_STUDIO_ENABLED!=="0";
  return ["prod","production"].includes(process.env.OTG_ENV||"") &&
    process.env.OTG_PRODUCTION_STUDIO_ENABLED==="1" &&
    process.env.OTG_PRODUCTION_ALLOWANCE_READY==="1";
}

export function productionStudioAudioEnabled() {
  return productionStudioEnabled() && (process.env.OTG_ENV==="test" ||
    (process.env.OTG_PRODUCTION_STUDIO_AUDIO_ENABLED==="1" &&
     (process.env.OTG_AUDIO_ENGINE_CONFIG||"").startsWith("/")));
}
