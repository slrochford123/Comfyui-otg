import sharp from "sharp";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const api=vi.hoisted(()=>({generate:vi.fn(),edit:vi.fn(),settle:vi.fn(),finish:vi.fn()}));
vi.mock("@/lib/auth/admin",()=>({isAdminUserId:()=>true}));
vi.mock("@/lib/openai/provider",()=>({openAIEnabled:()=>true,assertOpenAIAuthorized:()=>({id:"budget"}),getOpenAIClient:()=>({images:{generate:api.generate,edit:api.edit}})}));
vi.mock("@/lib/openai/usageLedger",()=>({settleOpenAIUsage:api.settle,finishUnsettledOpenAIUsage:api.finish}));
beforeEach(()=>{vi.stubEnv("OTG_ENV","test");vi.clearAllMocks();});
afterEach(()=>vi.unstubAllEnvs());
it("submits the installed Flare model with native HD and medium detail",async()=>{
  const bytes=await sharp({create:{width:960,height:960,channels:3,background:"blue"}}).png().toBuffer();
  api.generate.mockReturnValue({withResponse:async()=>({data:{usage:{input_tokens:10,output_tokens:20},data:[{b64_json:bytes.toString("base64")}]}})});
  const {renderStoryOpenAIImage}=await import("@/lib/storyCreator/mediaOpenAI");
  expect(await renderStoryOpenAIImage({accountId:"admin",ownerKey:"alice",projectId:"p",prompt:"A temple"})).toEqual(bytes);
  expect(api.generate).toHaveBeenCalledWith(expect.objectContaining({model:"gpt-image-2.6-flare",size:"960x960",quality:"medium",complexity:"medium"}),{timeout:150000,maxRetries:0});
  expect(api.settle).toHaveBeenCalledTimes(1);
});
it("allows an availability fallback and blocks safety failures",async()=>{
  const {renderStoryOpenAIImage}=await import("@/lib/storyCreator/mediaOpenAI");
  api.generate.mockReturnValue({withResponse:async()=>{throw {status:429,code:"rate_limit_exceeded"};}});
  await expect(renderStoryOpenAIImage({accountId:"admin",ownerKey:"alice",projectId:"p",prompt:"A temple"})).rejects.toMatchObject({fallbackAllowed:true});
  api.generate.mockReturnValue({withResponse:async()=>{throw {status:400,code:"moderation_blocked"};}});
  await expect(renderStoryOpenAIImage({accountId:"admin",ownerKey:"alice",projectId:"p",prompt:"A temple"})).rejects.toMatchObject({fallbackAllowed:false});
});
