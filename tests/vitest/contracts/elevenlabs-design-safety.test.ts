import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('@/lib/auth/providerUsage',()=>({hasUnlimitedProviderUsage:()=>false}));
import {createElevenLabsDesignPreview,saveElevenLabsDesignedVoice} from '@/lib/elevenlabsVoiceDesign';
beforeEach(()=>{vi.stubEnv('ELEVENLABS_ENABLED','true');vi.stubEnv('ELEVENLABS_API_KEY','disposable-offline-fixture');});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('ElevenLabs explicit-design safety',()=>{
 it('fails closed when the subscription/credit check fails',async()=>{const fetcher=vi.fn().mockResolvedValue(new Response('Unavailable',{status:503}));vi.stubGlobal('fetch',fetcher);await expect(createElevenLabsDesignPreview({voiceDescription:'A bright young adult tenor voice.',sampleText:'A'.repeat(120)},'fixture')).rejects.toThrow('subscription check failed');expect(fetcher).toHaveBeenCalledTimes(1);expect(String(fetcher.mock.calls[0][0])).toContain('/user/subscription');});
 it('saves the explicitly selected temporary ID and returns the permanent voice ID',async()=>{const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({voice_id:'permanent-id'})));vi.stubGlobal('fetch',fetcher);expect(await saveElevenLabsDesignedVoice({name:'Tiger',description:'Warm expressive voice',generatedVoiceId:'temporary-id'})).toBe('permanent-id');expect(fetcher).toHaveBeenCalledTimes(1);const [url,request]=fetcher.mock.calls[0];expect(url).toBe('https://api.elevenlabs.io/v1/text-to-voice');expect(JSON.parse(request.body)).toMatchObject({voice_name:'Tiger',generated_voice_id:'temporary-id'});});
 it('does not invent a permanent voice ID on a malformed response',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}')));await expect(saveElevenLabsDesignedVoice({name:'Tiger',description:'Warm voice',generatedVoiceId:'temporary-id'})).rejects.toThrow('saved voice ID');});
});
