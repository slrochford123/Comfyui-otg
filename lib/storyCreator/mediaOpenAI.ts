import sharp from "sharp";
import {getOpenAIClient, openAIEnabled, assertOpenAIAuthorized} from "@/lib/openai/provider";
import {finishUnsettledOpenAIUsage, settleOpenAIUsage} from "@/lib/openai/usageLedger";
import {isAdminUserId} from "@/lib/auth/admin";
import {toFile} from "openai";

export const storyOpenAIImageProfile = "gpt-image-2.6-flare" as const;
const priceVersion = "openai-image-2.6-flare-2026-11-08";
const maxSeconds = 150;
const reserveUsd = 0.25;

export function storyOpenAIImagesEnabled(accountId: unknown) {
  const test = process.env.OTG_ENV === "test";
  const enabled = test || (process.env.OTG_ENV === "prod" && process.env.OTG_STORY_OPENAI_IMAGE_ENABLED === "1");
  const globalCap = Number(process.env.OPENAI_DAILY_GLOBAL_COST_LIMIT_USD || (test ? "20" : "0"));
  return enabled && openAIEnabled() && Number.isFinite(globalCap) && globalCap > 0 && isAdminUserId(accountId);
}
export const storyOpenAIImageTimeoutMs = maxSeconds * 1000;

type ImageUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: {text_tokens?: number; image_tokens?: number};
};
export function storyImageUsageCost(usage: ImageUsage) {
  const input = usage.input_tokens, output = usage.output_tokens;
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 0 ||
      typeof output !== "number" || !Number.isSafeInteger(output) || output <= 0) {
    throw Error("OpenAI image usage could not be verified. The budget hold is retained for reconciliation.");
  }
  const text = usage.input_tokens_details?.text_tokens;
  // Charge observed token types at their published rates. When the provider
  // does not give a breakdown, retain a conservative image-input estimate.
  const textTokens = typeof text === "number" && Number.isSafeInteger(text) && text >= 0 && text <= input ? text : 0;
  return {input, output, usd:(textTokens*5+(input-textTokens)*8+output*30)/1_000_000};
}

export async function renderStoryOpenAIImage(options: {
  accountId: string; ownerKey: string; projectId: string; prompt: string; source?: string;
}) {
  if (!storyOpenAIImagesEnabled(options.accountId)) throw Error("GPT Image 2.6 is unavailable in this session.");
  if (!options.prompt || Buffer.byteLength(options.prompt) > 8192) throw Error("Shorten the GPT Image prompt to 8 KiB or less.");
  const image = options.source ? await toFile(await sharp(options.source, {limitInputPixels:50_000_000})
    .rotate().resize(1024,1024,{fit:"inside",withoutEnlargement:true}).png().toBuffer(),
  "story-source.png",{type:"image/png"}) : null;
  const request = {model:storyOpenAIImageProfile,n:1, size:"1024x1024", quality:"low",
    output_format:"png", complexity:"low"} as const;
  const budget = assertOpenAIAuthorized(options.ownerKey,"story-image",reserveUsd);
  try {
    const client = getOpenAIClient();
    const settings = {timeout:storyOpenAIImageTimeoutMs,maxRetries:0};
    const response = await (image
      ? client.images.edit({...request,prompt:options.prompt,image}, settings)
      : client.images.generate({...request,prompt:options.prompt}, settings)).withResponse();
    const usage = storyImageUsageCost(response.data.usage || {});
    settleOpenAIUsage(budget,{ts:Date.now(),ownerKey:options.ownerKey,accountId:options.accountId,
      projectId:options.projectId, useCase:"story-image",feature:"story-creator-image",model:storyOpenAIImageProfile,
      inputTokens:usage.input, outputTokens:usage.output, totalTokens:usage.input+usage.output, audioSeconds:0,
      approximateCostUsd:usage.usd,priceVersion}, response.request_id || undefined);
    const encoded = response.data.data?.[0]?.b64_json;
    if (!encoded || encoded.length > 24_000_000) throw Error("The image provider returned no usable PNG.");
    const bytes = Buffer.from(encoded,"base64");
    const metadata = await sharp(bytes,{limitInputPixels:2_000_000}).metadata();
    if (metadata.format !== "png" || metadata.width !== 1024 || metadata.height !== 1024) throw Error("The image provider returned an unexpected image format or size.");
    return bytes;
  } catch (cause) {
    const status = Number((cause as {status?:number})?.status);
    const rejected = [400,401,403,404,413,415,422,429].includes(status);
    finishUnsettledOpenAIUsage(budget,rejected);
    const error = Error(rejected
      ? `OpenAI rejected the GPT Image 2.6 request (HTTP ${status}). Check project access or the request and try again.`
      : "OpenAI did not confirm a usable image. The original request will not be retried automatically.");
    error.name = rejected ? "RejectedStoryMedia" : "UnconfirmedStoryOpenAIImage";
    throw error;
  }
}
