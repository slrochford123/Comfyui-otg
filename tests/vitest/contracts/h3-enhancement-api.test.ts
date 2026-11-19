import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const m=vi.hoisted(()=>({qwen:vi.fn(),cloud:vi.fn(),local:true}));
vi.mock('@/lib/workers/qwenClusterRouter',()=>({QWEN_CLUSTER_MODEL:'fixture'}));
vi.mock('@/lib/workers/qwenDurableFetch',()=>({qwenDurableFetch:m.qwen}));
vi.mock('@/lib/workers/local3060',()=>({LOCAL_MODEL:'qwen3.5:4b',local3060Enabled:()=>m.local}));
vi.mock('@/lib/sessionUser',()=>({requireSessionUser:async()=>({ownerKey:'owner',accountId:'account'})}));
vi.mock('@/lib/openai/provider',()=>({createOpenAIText:m.cloud,openAIEnabled:()=>false,openAIModels:()=>({h3:'unavailable'})}));
import {POST} from '@/app/api/enhance-prompt/route';
const source='the boy tells his mother that he has been making fun of by his friends at school, the mother says im so sorry what have they been saying';
const req=(extra:Record<string,unknown>={})=>new NextRequest('http://localhost/api/enhance-prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:source,purpose:'h3-scene-draft',...extra})});
beforeEach(()=>{vi.clearAllMocks();m.local=true;m.qwen.mockResolvedValue(Response.json({response:JSON.stringify({enhancedPrompt:'The boy confides in his mother about being mocked at school. His mother says [[SLR_DIALOGUE_1]]'})}));});
describe('H3 Enhance API with protected server-side dialogue rendering',()=>{
 it.each(['short','medium','long'])('uses the dedicated local provider and typed description schema for %s',async level=>{const r=await POST(req({enhanceLevel:level})),b=await r.json();expect(r.status).toBe(200);expect(b.ok).toBe(true);expect(b.provider).toBe('local3060');expect(b.enhancedPrompt).toContain('im so sorry what have they been saying');const [endpoint,payload,options]=m.qwen.mock.calls[0];expect(endpoint).toBe('/api/generate');expect(options.model).toBe('qwen3.5:4b');expect(payload.format.required).toEqual(['enhancedPrompt']);expect(payload.prompt).not.toContain('im so sorry');expect(payload.options.num_predict).toBeGreaterThanOrEqual(350);expect(m.cloud).not.toHaveBeenCalled();});
 it('retains the original exactly and reports failure for an invented output slot',async()=>{m.qwen.mockResolvedValue(Response.json({response:JSON.stringify({narrative:{description_99:'A changed scene'}})}));const r=await POST(req()),b=await r.json();expect(r.status).toBeGreaterThanOrEqual(400);expect(b.ok).toBe(false);expect(b.originalPrompt).toBe(source);expect(b.enhancedPrompt).toBeUndefined();});
 it('retains the original on a model/service failure, with no canned enhancement',async()=>{m.qwen.mockRejectedValue(Error('Local provider unavailable'));const r=await POST(req()),b=await r.json();expect(r.status).toBeGreaterThanOrEqual(400);expect(b.ok).toBe(false);expect(b.originalPrompt).toBe(source);expect(b.fallbackUsed).toBeUndefined();expect(m.cloud).not.toHaveBeenCalled();});
 it('does not change ordinary non-H3 enhancement response contracts',async()=>{m.qwen.mockResolvedValue(Response.json({response:JSON.stringify({enhancedPrompt:'An adult guard walks through a quiet gate.'})}));const r=await POST(new NextRequest('http://localhost/api/enhance-prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'An adult guard walks.',enhanceLevel:'short'})}));expect(r.status).toBe(200);expect((await r.json()).enhancedPrompt).toContain('An adult guard');expect(m.qwen.mock.calls[0][1].format.properties.enhancedPrompt).toBeDefined();});
});

it('never silently spills H3 enhancement onto a rendering GPU or paid provider when its dedicated lane is disabled',async()=>{m.local=false;const r=await POST(req()),b=await r.json();expect(r.status).toBe(503);expect(b.originalPrompt).toBe(source);expect(m.qwen).not.toHaveBeenCalled();expect(m.cloud).not.toHaveBeenCalled();});
