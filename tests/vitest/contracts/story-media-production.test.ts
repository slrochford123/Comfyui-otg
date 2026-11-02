import {afterEach,it,expect,vi} from 'vitest';
import {storyMediaEnabled,requireStoryMediaEnabled} from '@/lib/storyCreator/mediaAvailability';
afterEach(()=>vi.unstubAllEnvs());
it('requires an explicit production rollout and keeps the unrelated experimental gate separate',()=>{
  vi.stubEnv('NODE_ENV','production');vi.stubEnv('OTG_ENV','prod');vi.stubEnv('OTG_STORY_MEDIA_ENABLED','');
  expect(storyMediaEnabled()).toBe(false);expect(()=>requireStoryMediaEnabled()).toThrow();
  vi.stubEnv('OTG_STORY_MEDIA_ENABLED','1');expect(storyMediaEnabled()).toBe(true);expect(()=>requireStoryMediaEnabled()).not.toThrow();
  expect(process.env.OTG_ENV).toBe('prod');
});
it('retains the already qualified TEST workflow',()=>{
  vi.stubEnv('NODE_ENV','production');vi.stubEnv('OTG_ENV','test');vi.stubEnv('OTG_STORY_MEDIA_ENABLED','');
  expect(storyMediaEnabled()).toBe(true);
});
