/** Production rollout is explicit; the experimental workspace has its own TEST gate. */
export function storyMediaEnabled() {
  return process.env.OTG_ENV === "test" || process.env.NODE_ENV === "test" || process.env.OTG_STORY_MEDIA_ENABLED === "1";
}
export function requireStoryMediaEnabled() {
  if (!storyMediaEnabled()) throw Error("Story media creation is not enabled on this server.");
}

/** Keep the conversational rollout independently reversible. */
export const storyChatMediaEnabled = () => storyMediaEnabled() && process.env.OTG_STORY_CHAT_MEDIA === "1";
