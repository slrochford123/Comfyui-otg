import {afterEach,describe,expect,it,vi} from 'vitest';
import {characterDevelopmentEnabled,changeVoiceEnabled,requireCharacterDevelopment} from '@/lib/h3CharacterDevelopmentAvailability';
import {requireTestLab} from '@/lib/experiments/store';
afterEach(()=>vi.unstubAllEnvs());
describe('production H3 feature scopes',()=>{
 it('keeps new tools off in unconfigured PROD',()=>{vi.stubEnv('OTG_ENV','prod');vi.stubEnv('OTG_H3_CHARACTER_DEVELOPMENT_ENABLED','');vi.stubEnv('OTG_H3_CHANGE_VOICE_ENABLED','');expect(characterDevelopmentEnabled()).toBe(false);expect(changeVoiceEnabled()).toBe(false);expect(requireCharacterDevelopment).toThrow();});
 it('enables only the requested production tools and keeps Testing closed',()=>{vi.stubEnv('OTG_ENV','prod');vi.stubEnv('OTG_H3_CHARACTER_DEVELOPMENT_ENABLED','1');vi.stubEnv('OTG_H3_CHANGE_VOICE_ENABLED','1');expect(characterDevelopmentEnabled()).toBe(true);expect(changeVoiceEnabled()).toBe(true);expect(requireCharacterDevelopment).not.toThrow();expect(requireTestLab).toThrow();});
 it('retains TEST behavior',()=>{vi.stubEnv('OTG_ENV','test');expect(characterDevelopmentEnabled()).toBe(true);expect(changeVoiceEnabled()).toBe(true);});
});
