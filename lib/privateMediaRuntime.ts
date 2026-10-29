/** Operator deployment switches, not end-user approval or content restrictions. */
export function privateMediaEnvironmentEnabled() {
  return process.env.OTG_ENV === "test" ||
    (["prod","production"].includes(process.env.OTG_ENV||"") && process.env.OTG_PRIVATE_RESEARCH_MEDIA === "1");
}
export function privateMediaFeatureEnabled(name:"OTG_MEDIA_GPU_ROUTING"|"OTG_AUDIO_EDITING_ENABLED") {
  return privateMediaEnvironmentEnabled() && process.env[name] === "1";
}
