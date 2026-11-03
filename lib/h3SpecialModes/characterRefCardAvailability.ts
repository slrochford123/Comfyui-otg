/** RefMod cards have their own rollout flag. This never enables the Testing workspace. */
export function characterRefCardsEnabled() {
  return process.env.OTG_ENV === "test" || (process.env.OTG_ENV === "prod" && process.env.OTG_H3_CHARACTER_REFCARDS_ENABLED === "1");
}
