import {describe,expect,it} from 'vitest';
import {h3EnhancementDialogue,h3DraftEnhancementInput,h3DraftEnhancementTokens,h3DraftEnhancementSchema,readH3DraftEnhancement} from '@/lib/h3DraftEnhancement';
const source='the boy tells his mother that he has been making fun of by his friends at school, the mother says im so sorry what have they been saying';
const recorded="The young boy approaches his mother to break the news that he's been the subject of ridicule by his friends at school; upon hearing this, the mother immediately responds with a sigh of regret, asking, 'I'm so sorry. What have they been saying?'";
const read=(source:string,enhancedPrompt:string)=>readH3DraftEnhancement(source,JSON.stringify({enhancedPrompt}));
describe('H3 enhancement speech locks and reported narration',()=>{
 it('accepts the exact previously rejected school scene without treating reported events as literal dialogue',()=>{expect(h3EnhancementDialogue(source).map(s=>s.text)).toEqual(['im so sorry what have they been saying']);expect(read(source,recorded)).toBe(recorded);});
 it('withholds spoken words from the model and restores them once after prose editing',()=>{const input=h3DraftEnhancementInput(source);expect(input).not.toContain('im so sorry');expect(input).toContain('the boy tells his mother that');expect(input).toContain('the mother says [[SLR_DIALOGUE_1]]');const result=read(source,'The boy confides in his mother about school. The mother says [[SLR_DIALOGUE_1]]');expect(result).toContain('im so sorry what have they been saying');expect(result).not.toContain('[[SLR_');expect(h3DraftEnhancementSchema(source).required).toEqual(['enhancedPrompt']);});
 it.each(['She says that she needs help.','He tells his mother that he feels cold.','He told her he felt cold.','She asks about his day.'])('does not lock indirect narration: %s',s=>{expect(h3EnhancementDialogue(s)).toHaveLength(0);});
 it.each([['The guard says "Hold the door."','Hold the door.'],["The guard says 'Hold the door.'",'Hold the door.'],['The guard says “Hold the door.”','Hold the door.'],['The guard says <d>[English] Hold the door.</d>','<d>[English] Hold the door.</d>']])('preserves exact explicit dialogue in %s',(s,line)=>{const input=h3DraftEnhancementInput(s);expect(input.match(/\[\[SLR_DIALOGUE_1\]\]/g)).toHaveLength(1);expect(read(s,'The guard stands watch and says [[SLR_DIALOGUE_1]]')).toContain(line);});
 it('does not mistake contraction apostrophes for quote boundaries',()=>{const s="He tells his friend that he's tired. His mother's outside.";expect(h3EnhancementDialogue(s)).toHaveLength(0);expect(read(s,"He tells his friend that he's weary. His mother waits outside.")).toContain('weary');});
 it('preserves two dictated turns without capturing the next speaker as dialogue',()=>{const s='Darius says Hello, Raphael says Goodbye';expect(h3EnhancementDialogue(s).map(x=>x.text)).toEqual(['Hello','Goodbye']);expect(read(s,'Darius says [[SLR_DIALOGUE_1]], Raphael says [[SLR_DIALOGUE_2]]')).toBe(s);});
 it('supports the same literal line spoken by two characters once each',()=>{const s='Darius says "Hello." Raphael says "Hello."';expect(read(s,'Darius says [[SLR_DIALOGUE_1]] Raphael says [[SLR_DIALOGUE_2]]')).toBe(s);});
 it.each(['A guard says [[SLR_DIALOGUE_2]] [[SLR_DIALOGUE_1]]','A guard says [[SLR_DIALOGUE_1]] [[SLR_DIALOGUE_1]]','A guard says [[SLR_DIALOGUE_99]]'])('rejects reordered, duplicate or unknown locks: %s',result=>{expect(()=>read('A guard says "Hold." Another guard says "Wait."',result)).toThrow('locked dialogue');});
 it('rejects real changes to spoken words rather than simply appending the correct line',()=>{expect(()=>read(source,recorded.replace('sorry','happy'))).toThrow('changed dialogue');expect(()=>read('A guard says "Hold the door."','A guard says "Close the door."')).toThrow('changed dialogue');});
 it('rejects duplicated dialogue outside a valid marker',()=>{expect(()=>read('A guard says "Hold the door."','A guard says [[SLR_DIALOGUE_1]] and repeats "Hold the door."')).toThrow();});
 it('keeps a complete JSON/long-source response budget for each level',()=>{for(const level of ['short','medium','long'] as const){expect(h3DraftEnhancementTokens('x'.repeat(3500),level)).toBeGreaterThan(1400);expect(h3DraftEnhancementTokens('x'.repeat(8000),level)).toBeLessThanOrEqual(2200);}});
 it('fails closed on corrupt output or unfinished markers',()=>{expect(()=>readH3DraftEnhancement(source,'{"enhancedPrompt":')).toThrow();expect(()=>read(source,'The boy says [[SLR_DIALOGUE_wrong]]')).toThrow();});
});

describe('exact speech restoration',()=>{
 it('preserves speaker order and each line once',()=>{const s='Darius says "Hello." Raphael says "Goodbye."';const out=read(s,'Darius smiles and says [[SLR_DIALOGUE_1]]. Raphael turns and says [[SLR_DIALOGUE_2]]');expect(out.match(/Hello\./g)).toHaveLength(1);expect(out.match(/Goodbye\./g)).toHaveLength(1);expect(out.indexOf('Hello.')).toBeLessThan(out.indexOf('Goodbye.'));});
 it('does not double quotation wrappers added by the model around an opaque slot',()=>{const s='A guard says "Hello."';expect(read(s,'The guard smiles and says "[[SLR_DIALOGUE_1]]"')).toBe('The guard smiles and says "Hello."');});
 it('rejects an invented quoted line beside a correct locked slot',()=>{expect(()=>read('A guard says "Hold."','The guard says [[SLR_DIALOGUE_1]] and says "Run away."')).toThrow('extra dialogue');});
});

it.each(['"[[SLR_DIALOGUE_1]]."',"'[[SLR_DIALOGUE_1]]!'",'“[[SLR_DIALOGUE_1]]?”'])('accepts a punctuation-only quoted slot without inventing or doubling words: %s',slot=>{const out=read('A guard says hello','A guard replies, '+slot);expect(out).toContain('hello');expect(out.match(/hello/g)).toHaveLength(1);});
it('still rejects new words inside a quote containing a correct slot',()=>{expect(()=>read('A guard says hello','A guard replies, "[[SLR_DIALOGUE_1]] and run away."')).toThrow('extra dialogue');});

describe('speech attribution chains and short dialogue in narration',()=>{
 const scene='The mother tells the boy in yellow named terrence she says "Terrence go to your room" Terrence replies "but Mom" she yells she yells "now!" Terrence then starts to walk away looks back at the mother in the three boys then walks off screen the mother looks at the boy in green and said "let\'s get this over with"';
 it('recognizes only the four real lines in the recorded failed scene',()=>{
  expect(h3EnhancementDialogue(scene).map(s=>s.text)).toEqual(['"Terrence go to your room"','"but Mom"','"now!"','"let\'s get this over with"']);
 });
 it('accepts each exact spoken slot once while ordinary she and now remain editable narration',()=>{
  const input=h3DraftEnhancementInput(scene);
  const out=read(scene,input+' She now stands quietly. She keeps her gaze on the doorway.');
  expect(out).toContain('She now stands quietly.');
  expect(out.match(/"now!"/g)).toHaveLength(1);
 });
 it('does not count narration as another utterance of a one-word line',()=>{
  expect(read('The guard says "Now!"','The guard now turns toward the doorway and says [[SLR_DIALOGUE_1]]. The room is now quiet.')).toContain('"Now!"');
 });
 it('keeps genuine mixed dictated and quoted turns',()=>{
  expect(h3EnhancementDialogue('Darius says Hello, Raphael says "Goodbye."').map(s=>s.text)).toEqual(['Hello','"Goodbye."']);
 });
 it.each(['The guard says [[SLR_DIALOGUE_1]]. Another guard says now.','The guard says [[SLR_DIALOGUE_1]]. Another guard says "Now!"'])('rejects actual repeated short speech beside a valid slot: %s',out=>{
  expect(()=>read('The guard says "Now!"',out)).toThrow();
 });
 it('rejects a raw repeated longer line even if unquoted',()=>{
  expect(()=>read('The guard says "Hold the door."','The guard says [[SLR_DIALOGUE_1]]. Then he says Hold the door.')).toThrow();
 });
});
