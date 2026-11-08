// OpenAI Standard prices verified 2026-11-07. USD per million tokens.
// https://developers.openai.com/api/docs/pricing
export const conversationPriceVersion = "openai-standard-2026-11-07";

const prices = {
  "gpt-6-luna": [0.10, 0.01, 0.125, 0.50],
  "gpt-6.1-sol": [2, 0.10, 2.50, 10],
  "gpt-4.1-mini": [0.40, 0.10, 0.40, 1.60],
} as const;

export function conversationPrice(model: string) {
  const base = Object.keys(prices).find(name => model === name || new RegExp(`^${name.replaceAll(".", "\\.")}-\\d{4}-\\d{2}-\\d{2}$`).test(model));
  if (!base) throw new Error("This OpenAI conversational model has no verified allowance pricing.");
  return { rates: prices[base as keyof typeof prices], longContext: base.startsWith("gpt-6") };
}

export function conversationCostNanos(model: string, usage: {
  inputTokens: number; outputTokens: number; cachedInputTokens?: number; cacheWriteTokens?: number;
}) {
  const {rates: [input, cached, write, output], longContext} = conversationPrice(model);
  const cachedCount = Math.min(usage.inputTokens, usage.cachedInputTokens || 0);
  const written = Math.min(usage.inputTokens - cachedCount, usage.cacheWriteTokens || 0);
  const uncached = usage.inputTokens - cachedCount - written;
  const long = longContext && usage.inputTokens > 272_000;
  return Math.round(1000 * ((uncached * input + cachedCount * cached + written * write) * (long ? 2 : 1)
    + usage.outputTokens * output * (long ? 1.5 : 1)));
}

export function conversationReserveNanos(model: string, inputBytes: number, maxOutputTokens: number) {
  const inputTokens = inputBytes + 4096;
  return conversationCostNanos(model, {inputTokens, outputTokens:maxOutputTokens, cacheWriteTokens:inputTokens});
}
