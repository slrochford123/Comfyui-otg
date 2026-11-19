export type CharacterVoiceProvider = 'qwen3' | 'elevenlabs';
export const CHARACTER_VOICE_SAMPLE = "There you are. I was hoping you would join us. We have a little work to finish, and then we can sit together and enjoy the evening.";
export function expandCharacterVoiceDescription(value:string) {
 const description=value.trim();
 if(!description||description.length>650)throw Error('Describe the voice in 1–650 characters.');
 return `Design one original speaking voice with these requested traits: ${description}\nKeep all requested identity, age, pitch, accent and texture characteristics. Use natural articulation, expressive conversational delivery, and realistic human pacing. Do not invent a different accent, age, or gender. Clean single-speaker speech, without music or environmental effects.`;
}
export type CharacterVoicePreview = {id:string;audioUrl:string};
export type CharacterVoiceAudition = {id:string;provider:CharacterVoiceProvider;description:string;status:string;message?:string;previews:CharacterVoicePreview[];savedVoiceId?:string;selectedPreview?:string};
export type CharacterVoiceOptions = {qwenAvailable:boolean;elevenAvailable:boolean;elevenMessage:string;remaining:number|null;creditNote:string};
export type SavedCharacterSummary = {id:string;name:string;imageUrl:string;voiceName?:string;voiceAudioUrl?:string;voiceProvider?:string};
