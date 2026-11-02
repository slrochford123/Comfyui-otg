/** One model response supplies the reply and evidence-backed memory proposals.
 * No second paid extraction request is made for an ordinary conversation turn.
 */
export const STORY_CONVERSATION_SCHEMA = {
  name: "story_conversation_v1",
  schema: {
    type: "object", additionalProperties: false, required: ["reply", "facts"],
    properties: {
      reply: { type: "string" },
      facts: { type: "array", items: {
        type: "object", additionalProperties: false,
        required: ["subjectName", "entityType", "predicate", "valueText", "evidence"],
        properties: {
          subjectName: { type: "string" }, entityType: { type: "string", enum: ["character", "location", "faction", "object", "other"] },
          predicate: { type: "string" }, valueText: { type: "string" }, evidence: { type: "string" },
        },
      } },
    },
  },
};

export const STORY_MEMORY_INSTRUCTION = [
  "Return the required JSON object with reply first: reply is your normal conversational answer, facts is a short array of only unambiguous new facts asserted by the user in their latest saved message.",
  "Each fact needs an exact verbatim evidence quotation from that latest user message, its explicitly named subject, a short snake_case predicate, and a valueText quoted directly from that evidence.",
  "Use no facts for speculation, instructions, questions, quoted character dialogue, unadopted ideas or your own suggestions. Do not infer names from pronouns, narrow roles or add specificity.",
  "An empty facts array is preferable to guessing. Do not claim canon is updated in reply: the server must validate and save facts first. Keep at most eight facts.",
].join("\n");

/** Display only a safely decoded reply field, never raw JSON or metadata. */
export function partialStoryReply(raw: string) {
  const start = /^\s*\{\s*"reply"\s*:\s*"/.exec(raw);
  if (!start) return "";
  let encoded = "";
  let escaped = false;
  for (const character of raw.slice(start[0].length)) {
    if (!escaped && character === '"') break;
    encoded += character;
    if (character === "\\" && !escaped) escaped = true;
    else escaped = false;
  }
  // Incomplete escape sequences are withheld until the next delta arrives.
  for (let trim = 0; trim <= Math.min(6, encoded.length); trim++) {
    try { return JSON.parse(`"${trim ? encoded.slice(0, -trim) : encoded}"`) as string; }
    catch { /* wait for a complete escape */ }
  }
  return "";
}

export function parseStoryConversation(raw: string, source: string) {
  const object = JSON.parse(raw);
  if (typeof object.reply !== "string" || !object.reply.trim() || !Array.isArray(object.facts)) throw new Error("Invalid completed story reply.");
  const entities: Array<{ entityType: string; name: string }> = [];
  const facts: Array<{ subjectName: string; predicate: string; valueText: string; canonStatus: "suggestion" }> = [];
  const uncertain = /\b(what if|maybe|perhaps|possibly|imagine|suppose|could we|should we|might be|for example|pretend)\b/i.test(source);
  if (!uncertain) for (const candidate of object.facts.slice(0, 8)) {
    const { subjectName, entityType, predicate, valueText, evidence } = candidate || {};
    if ([subjectName, entityType, predicate, valueText, evidence].some((value) => typeof value !== "string" || !value.trim())) continue;
    if (subjectName.length > 160 || valueText.length > 600 || evidence.length > 2000 || !/^[a-z][a-z0-9_]{1,59}$/.test(predicate)) continue;
    if (!["character", "location", "faction", "object", "other"].includes(entityType)) continue;
    if (!source.includes(evidence) || !evidence.includes(subjectName) || !evidence.includes(valueText)) continue;
    if (/[?"“”]/.test(evidence)) continue;
    const preceding = source.slice(0, source.indexOf(evidence));
    if ((preceding.match(/"/g) || []).length % 2 || preceding.lastIndexOf("“") > preceding.lastIndexOf("”")) continue;
    if (/\b(not|never|without|no)\b|n't\b/i.test(evidence) && !/\b(not|never|without|no)\b|n't\b/i.test(valueText)) continue;
    if (!/\b(is|are|has|have|lives|works|wears|owns|protects|raised|was|were|can|knows|uses|belongs)\b/i.test(evidence)) continue;
    if (!entities.some((entity) => entity.name === subjectName)) entities.push({ entityType, name: subjectName });
    facts.push({ subjectName, predicate, valueText, canonStatus: "suggestion" });
  }
  return { reply: object.reply.trim(), memory: { entities, facts } };
}
