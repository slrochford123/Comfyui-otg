export type VoiceCreatorProviderId = "minimax_h3" | "ltx25";
export type VoiceCreatorLibraryId = "natural" | "fictional";
export type VoiceCreatorAge = "adult" | "elderly" | "teenager" | "child";
export type VoiceCreatorPresentation = "male" | "female" | "neutral";

export type VoiceCreatorPreset = {
  id: string;
  label: string;
  category: string;
  age: string;
  presentation: string;
  description: string;
  auditionLine: string;
};

const H3_NATURAL: VoiceCreatorPreset[] = [
  { id: "001", label: "Scottish Highlands", category: "Highland Scottish English", age: "adult", presentation: "male", description: "rhotic R; open vowels; slower Highland cadence; light Gaelic-influenced melody; weathered resonant baritone", auditionLine: "Aye, the weather rolls over these rough hills fast, so we'd better head home before dark." },
  { id: "002", label: "Glasgow Scottish", category: "Glaswegian", age: "adult", presentation: "female", description: "quick local rhythm; strong glottal stops; compressed vowels; lively pitch movement; smoky alto", auditionLine: "Aye, I'll meet you round the corner after work, then we'll head straight into town." },
  { id: "003", label: "Edinburgh Scottish", category: "Edinburgh Scottish English", age: "adult", presentation: "male", description: "clear consonants; lightly rhotic; restrained but recognizably Scottish rhythm; smooth tenor", auditionLine: "I'll meet you near the old stone bridge, then we'll walk through the centre together." },
  { id: "004", label: "Dublin Irish", category: "Dublin English", age: "adult", presentation: "female", description: "bright forward vowels; rhythmic sentence melody; lively connected speech; warm mezzo", auditionLine: "Sure, I'll call you after work and we'll head over together before the rain starts." },
  { id: "006", label: "Belfast Northern Irish", category: "Belfast English", age: "adult", presentation: "female", description: "strong local vowel shifts; crisp consonants; rising-falling rhythm; grounded alto", auditionLine: "I'll give you a shout when I'm round the corner, so keep an ear out for me." },
  { id: "007", label: "Cardiff Welsh", category: "Cardiff English", age: "adult", presentation: "male", description: "Welsh-influenced melody; rounded vowels; clear consonants; friendly baritone", auditionLine: "We'll head down through town first, then come back before the weather turns rough." },
  { id: "008", label: "South Wales Valleys", category: "Valleys English", age: "elderly", presentation: "female", description: "musical rise and fall; strong local vowels; warm deliberate cadence; older contralto", auditionLine: "Come in out of that cold, love; I've put the kettle on and there's plenty of time." },
  { id: "009", label: "Modern RP British", category: "Modern Received Pronunciation", age: "adult", presentation: "male", description: "non-rhotic; precise consonants; balanced vowels; calm measured cadence; polished baritone", auditionLine: "Three red cars were parked beside the broad road before the morning meeting began." },
  { id: "010", label: "Cockney London", category: "Cockney / East London", age: "adult", presentation: "female", description: "non-rhotic; glottal stops; natural th-fronting tendencies; lively East London rhythm; bright mezzo", auditionLine: "I'll meet you down the market later, then we'll grab a cup of tea round the corner." },
  { id: "011", label: "Yorkshire English", category: "West Yorkshire", age: "elderly", presentation: "male", description: "short northern vowels; direct rhythm; restrained intonation; older gravelly baritone", auditionLine: "Put kettle on, lad; we'll sort the rest after we've been down the road." },
  { id: "012", label: "Geordie Newcastle", category: "Tyneside Geordie", age: "adult", presentation: "female", description: "distinctive Tyneside vowels; lively pitch; fast warm local rhythm; clear alto", auditionLine: "I'll gan down the road in a minute and see whether they're still waiting there." },
  { id: "013", label: "Scouse Liverpool", category: "Liverpool English", age: "adult", presentation: "male", description: "bright nasal resonance; sharp local consonant quality; rapid melodic cadence; youthful tenor", auditionLine: "I'll ring you later, then we'll head down the road and sort the whole thing out." },
  { id: "015", label: "Manchester English", category: "Manchester English", age: "adult", presentation: "male", description: "northern short-a system; compact vowels; steady urban rhythm; dry conversational baritone", auditionLine: "We're heading into town after work, so give us a ring if you fancy coming." },
  { id: "016", label: "West Country English", category: "West Country", age: "elderly", presentation: "female", description: "rhotic R; open vowels; slower rural rhythm; warm grounded melody", auditionLine: "We'll take the long road past the farm, then turn right by the old red barn." },
  { id: "017", label: "Norfolk East Anglian", category: "Norfolk English", age: "elderly", presentation: "male", description: "broad East Anglian vowels; softened consonants; unhurried cadence; older bass-baritone", auditionLine: "We'll get that sorted after dinner; there's no sense racing round before then." },
  { id: "019", label: "Multicultural London English", category: "MLE", age: "adult", presentation: "male", description: "contemporary London rhythm; fronted vowels; crisp consonants; urban youthful tenor without caricature", auditionLine: "I'll message you when I'm nearby, then we'll head over together and sort it out." },
  { id: "022", label: "New York City", category: "NYC English", age: "adult", presentation: "female", description: "strong urban rhythm; characteristic NYC vowel coloring; fast conversational pacing; low mezzo", auditionLine: "I'll grab a coffee on Thirty-Third Street, then meet you right near the train." },
  { id: "023", label: "Boston", category: "Eastern New England", age: "elderly", presentation: "male", description: "non-rhotic tendencies; broad local vowels; clipped timing; older baritone", auditionLine: "Park the car by the harbor, then we'll walk through the yard and grab a coffee." },
  { id: "024", label: "Philadelphia", category: "Philadelphia English", age: "adult", presentation: "female", description: "regional vowel shifts; quick Mid-Atlantic rhythm; direct confident alto", auditionLine: "I'll meet you after work near the water, then we'll head over to the corner store." },
  { id: "025", label: "Southern Appalachian", category: "Southern Appalachian English", age: "elderly", presentation: "male", description: "rhotic; musical pitch; conservative vowel patterns; slower storytelling cadence; weathered baritone", auditionLine: "We were raised along that ridge, where the road runs rough past the river and the pines." },
  { id: "026", label: "Deep South Georgia", category: "Georgia Southern English", age: "adult", presentation: "female", description: "elongated southern vowels; smooth drawl; warm cadence; natural regional mezzo", auditionLine: "Y'all come on in now; supper's ready, and we're fixin' to head out before long." },
  { id: "027", label: "Texas", category: "Texas English", age: "adult", presentation: "male", description: "rhotic; broad diphthongs; relaxed drawl; confident direct baritone", auditionLine: "We'll head down the road after breakfast and be back before the hard afternoon heat." },
  { id: "028", label: "Cajun Louisiana", category: "Cajun English", age: "elderly", presentation: "male", description: "Louisiana French-influenced rhythm and vowel quality; lively older baritone", auditionLine: "We'll take it slow, cher, then head down by the river and cook supper when we get back." },
  { id: "036", label: "Newfoundland Canadian", category: "Newfoundland English", age: "elderly", presentation: "male", description: "Irish and West Country historical influence; lively local melody; distinctive vowels; older baritone", auditionLine: "We'll have a cup of tea first, b'y, then we'll head out once the weather clears." },
  { id: "040", label: "Louisiana Creole", category: "Louisiana Creole", age: "elderly", presentation: "female", description: "regionally grounded Creole rhythm and vowel quality; warm older alto", auditionLine: "We'll take our time, then head down the road together once everybody is ready." },
  { id: "041", label: "Jamaican", category: "Jamaican English", age: "adult", presentation: "male", description: "authentic Jamaican rhythm, vowel quality and consonant patterns; natural code-switching; resonant tenor-baritone", auditionLine: "I'll reach soon, so hold a little space for me and we'll head down the road together." },
  { id: "042", label: "Trinidadian", category: "Trinidadian English", age: "adult", presentation: "female", description: "melodic Caribbean rhythm; local vowel color; fluid code-switching; bright alto", auditionLine: "I'm coming just now, so keep a seat for me and we'll head out when I reach." },
  { id: "043", label: "Barbadian", category: "Barbadian English", age: "adult", presentation: "male", description: "rapid Bajan rhythm; local vowel system; clipped consonants; warm baritone", auditionLine: "I'll come down later, then we'll sort everything out and head home together." },
  { id: "044", label: "Guyanese", category: "Guyanese English", age: "adult", presentation: "female", description: "Creole-influenced rhythm and vowels; lively phrasing; clear mezzo", auditionLine: "I'll reach just now, so don't start without me; we'll handle the rest together." },
  { id: "079", label: "Belgrade Serbian", category: "Belgrade Serbian", age: "adult", presentation: "male", description: "native Serbian transfer; strong regional R, consonant clusters, th behavior, and Balkan rhythm", auditionLine: "Three red trains rolled through the wide street while we waited near the river bridge." },
  { id: "087", label: "Delhi Hindi", category: "Delhi Hindi", age: "adult", presentation: "male", description: "retroflex T/D, Indian syllable timing, v/w behavior, strong clear R", auditionLine: "Three very warm trains rolled through the crowded street while we waited near the river bridge." },
  { id: "088", label: "Punjab Punjabi", category: "Eastern Punjabi", age: "elderly", presentation: "male", description: "Punjabi tonal melody, retroflex consonants, v/w behavior, energetic syllable timing", auditionLine: "Three brothers drove the bright white van through the crowded street near the river." },
  { id: "089", label: "Kolkata Bengali", category: "Kolkata Bengali", age: "adult", presentation: "female", description: "Bengali rhythm, aspirated consonants, v/b and th transfer, melodic cadence", auditionLine: "Three red trains rolled through the crowded street while we waited near the river." },
  { id: "090", label: "Chennai Tamil", category: "Chennai Tamil", age: "adult", presentation: "female", description: "retroflex consonants, syllable-timed rhythm, r/l distinctions and Indian stress", auditionLine: "Three red trains rolled through the crowded street while we waited near the river bridge." },
  { id: "091", label: "Kerala Malayalam", category: "Central Kerala Malayalam", age: "adult", presentation: "male", description: "Malayalam retroflex consonants, vowel length influence, syllable timing, clear R/L patterns", auditionLine: "Three red trains rolled through the crowded street while we waited near the river." },
  { id: "092", label: "Lahore Urdu", category: "Lahori Urdu", age: "adult", presentation: "female", description: "Urdu retroflex consonants, aspirates, elegant Hindustani rhythm, v/w behavior", auditionLine: "Three warm red vans drove through the crowded street while we waited near the river." },
  { id: "094", label: "Beijing Mandarin", category: "Beijing Mandarin", age: "adult", presentation: "male", description: "Beijing Mandarin syllable timing, R/L behavior, th behavior, consonant-cluster timing, tonal melody influence", auditionLine: "Three red cars went down the crowded street toward the river." }
];

const LTX25_NATURAL_IDS = new Set(["001","002","003","004","005","006","007","008","009","010","011","012","013","014","015","016","017","018","019","020","021","022","024","025","026","029","030","031","032","034","035","036","037","040","041","042","043","045","046","047","048","049","050","051","052","055","056","057","058","059","060","061","062","063","064","065","066","068","070","071","072","073","074","075","077","078","079","081","082","083","084","085","086","087","088","090","092","094","095","096","097","098","099","100"]);
const LTX25_NAMES = ["Scottish Highlands","Glasgow Scottish","Edinburgh Scottish","Dublin Irish","Cork Irish","Belfast Northern Irish","Cardiff Welsh","South Wales Valleys","Received Pronunciation British","Cockney London","Yorkshire English","Geordie Newcastle","Scouse Liverpool","Brummie Birmingham","Manchester English","West Country English","Norfolk East Anglian","Essex English","Cornish English","Multicultural London English","General American","New York City","Boston","Philadelphia","Southern Appalachian","Deep South Georgia","Texas","Cajun Louisiana","New Orleans Yat","Upper Midwest Minnesota","Chicago Inland North","California","Pacific Northwest","Pittsburgh","Baltimore","General Canadian","Newfoundland Canadian","Quebec Anglophone","Nova Scotia Canadian","Broad Australian","General Australian","New Zealand","Cape Town South African English","Afrikaans-accented English","Zimbabwean English","Nigerian English","Ghanaian English","Kenyan English","Ugandan English","Tanzanian English","Zambian English","Botswana English","Ethiopian-accented English","Somali-accented English","Jamaican English","Trinidadian English","Barbadian English","Guyanese English","Bahamian English","Mumbai Indian English","Delhi Indian English","Punjabi-accented English","Bengali-accented English","Tamil-accented English","Kerala Malayalam-accented English","Sri Lankan English","Pakistani Urdu-accented English","Bangladeshi English","Nepali-accented English","Singapore English","Malaysian English","Filipino English","Indonesian-accented English","Thai-accented English","Vietnamese-accented English","Mandarin Chinese-accented English","Hong Kong Cantonese-accented English","Taiwanese Mandarin-accented English","Japanese-accented English","Korean-accented English","Russian-accented English","Ukrainian-accented English","Polish-accented English","Czech-accented English","Hungarian-accented English","Romanian-accented English","Greek-accented English","Turkish-accented English","Egyptian Arabic-accented English","Levantine Arabic-accented English","Gulf Arabic-accented English","Moroccan-accented English","Persian-accented English","Parisian French-accented English","Quebec French-accented English","Castilian Spanish-accented English","Brazilian Portuguese-accented English","Italian-accented English","German-accented English","Dutch-accented English"];
const LTX25_NATURAL: VoiceCreatorPreset[] = LTX25_NAMES.map((label, index) => ({ id: String(index + 1).padStart(3, "0"), label, category: "Regional accent", age: "adult", presentation: index % 2 ? "female" : "male", description: `Natural ${label} regional voice with strong identifiable vowel shapes, consonants, rhythm, stress, and intonation.`, auditionLine: "The storm is coming. Lock the gate before midnight." })).filter((item) => LTX25_NATURAL_IDS.has(item.id));

const FICTIONAL: VoiceCreatorPreset[] = [
  ["001","Dwarf Forge Master","Fantasy Humanoid","adult","male","Deep compact baritone, dense chest resonance, gravelly stone-and-smoke texture, deliberate hammer-like cadence, proud and practical.","The mountain remembers every blade I have ever forged."],
  ["002","Ancient Dwarf King","Fantasy Humanoid","elderly","male","Very low aged bass, heavy resonance, slow ceremonial cadence, worn but powerful, dignified and authoritative.","My crown was old before your kingdom had a name."],
  ["003","Goblin Tinkerer","Fantasy Humanoid","adult","male","Small wiry tenor, nasal metallic edge, quick irregular rhythm, clever and twitchy, fully intelligible.","Careful with that lever. I only built it yesterday."],
  ["004","Goblin Matriarch","Fantasy Humanoid","elderly","female","Raspy alto, sharp consonants, dry leathery texture, quick suspicious cadence, commanding rather than comic.","Bring me the map, and keep your fingers off my gold."],
  ["005","Orc Warchief","Fantasy Humanoid","adult","male","Huge dark baritone, thick chest resonance, rough throat texture, clipped forceful delivery, disciplined rather than screaming.","Stand your ground. We break the gate before sunrise."],
  ["006","Orc Shaman","Fantasy Humanoid","elderly","female","Low smoky contralto, slow ritual cadence, breathy undertone, earthy resonance, ancient and focused.","The spirits are restless. Something walks beneath the soil."],
  ["007","Forest Elf Ranger","Fantasy Humanoid","adult","female","Clear agile mezzo voice, light airy resonance, precise diction, quiet alert cadence, elegant but grounded.","Stay beneath the branches. The hunters are close."],
  ["008","High Elf Prince","Fantasy Humanoid","adult","male","Smooth bright tenor, refined resonance, measured aristocratic cadence, cool self-control.","You mistake patience for weakness. Do not do so again."],
  ["009","Dark Elf Assassin","Fantasy Humanoid","adult","female","Low intimate alto, dry whisper edge, precise consonants, controlled cold cadence, dangerous without shouting.","You never heard me enter. That was your first mistake."],
  ["010","Troll Bridge Keeper","Fantasy Humanoid","adult","male","Massive low bass, slow thick articulation, cavernous resonance, blunt simple cadence, intimidating but understandable.","No coin, no crossing. Those are the bridge rules."],
  ["011","Village Witch","Magic User","elderly","female","Warm cracked alto, dry herbal rasp, intimate storyteller cadence, clever and unsettling.","The potion is harmless, provided you tell me the truth."],
  ["012","War Witch","Magic User","adult","female","Powerful contralto, sharp attack, smoky resonance, controlled martial cadence, intimidating.","Draw your sword if you like. The curse has already begun."],
  ["013","Court Warlock","Magic User","adult","male","Silky dark baritone, polished diction, faint breathy undertone, manipulative measured cadence.","Every bargain has a price. Yours is simply overdue."],
  ["014","Young Sorcerer","Magic User","teenager","male","Bright youthful tenor, energetic resonance, slightly breathless confidence, natural youthful cadence.","I know the spell works. I just need one more chance."],
  ["015","Archmage","Magic User","elderly","male","Aged resonant bass-baritone, calm exact diction, slow intellectual cadence, immense controlled presence.","Magic is not power. It is responsibility sharpened by knowledge."],
  ["016","Necromancer","Magic User","adult","male","Dry hollow baritone, low breath, restrained rasp, slow clinical cadence, unsettling clarity.","The dead are excellent listeners. They rarely interrupt."],
  ["017","Druid Elder","Magic User","elderly","female","Earthy contralto, soft breath, slow organic cadence, warm bark-like resonance, peaceful authority.","The river has changed its song. We should listen."],
  ["018","Rune Priest","Magic User","adult","male","Firm resonant baritone, measured ceremonial rhythm, clear hard consonants, solemn delivery.","Speak the rune correctly, or the door will answer badly."],
  ["019","Chaos Mage","Magic User","adult","female","Bright unstable mezzo, unpredictable micro-pauses, layered airy edge, playful dangerous cadence.","Probability is just a suggestion if you know where to push."],
  ["020","Blood Oracle","Magic User","adult","female","Low velvety alto, intimate prophetic cadence, faint breathy double-tone, calm and ominous.","I have seen your victory. I have also seen its cost."],
  ["021","Guardian Angel","Celestial","adult","female","Clear luminous mezzo, gentle harmonic sheen, calm reassuring cadence, pure intelligible human core.","You are not alone. Walk forward and keep your heart steady."],
  ["022","Archangel Commander","Celestial","adult","male","Powerful resonant baritone, bright upper harmonics, formal commanding cadence, immense but controlled.","Raise the shield. No darkness crosses this line tonight."],
  ["023","Fallen Angel","Celestial","adult","male","Beautiful low tenor with faint cracked undertone, elegant melancholy cadence, subtle doubled resonance.","I remember heaven clearly. That is what makes this hurt."],
  ["024","Celestial Child","Celestial","child","neutral","Clear innocent child voice, perfect calm pitch, faint glassy harmonic halo, gentle uncanny cadence.","The stars are awake. They have been waiting for you."],
  ["025","Seraphim Voice","Celestial","adult","female","Single intelligible female voice with subtle multi-harmonic choral overtones, radiant sustained resonance, slow ceremonial cadence.","Be still. The gate of morning is opening."],
  ["026","Star Messenger","Celestial","adult","neutral","Smooth gender-neutral mid register, bright crystalline harmonics, precise calm cadence, distant celestial quality.","Your signal crossed seven worlds before it reached me."],
  ["027","Sun Priestess","Celestial","adult","female","Warm radiant alto, clear chest resonance, ceremonial warmth, measured hopeful cadence.","Stand in the light. Let it show you what remains."],
  ["028","Moon Herald","Celestial","adult","male","Soft low tenor, airy nocturnal resonance, slow poetic cadence, faint whisper-like upper harmonic.","The moon keeps every secret spoken beneath its light."],
  ["029","Demon General","Infernal","adult","male","Huge dark baritone, controlled subharmonic growl, clipped military cadence, clear human core, restrained rage.","Break their formation. Leave the gates for me."],
  ["030","Demon Queen","Infernal","adult","female","Powerful low contralto, elegant chest resonance, subtle subharmonic undertone, cold measured cadence.","Kneel if you wish. It will not change the verdict."],
  ["031","Imp Trickster","Infernal","adult","male","Small sharp tenor, quick mischievous rhythm, scratchy edge, sly articulation, energetic but intelligible.","I never said the contract was fair. I said it was signed."],
  ["032","Pit Fiend","Infernal","adult","male","Extremely low cavernous bass, rough volcanic texture, slow forceful cadence, deep subharmonic body.","The chains are not for me. They are for what follows."],
  ["033","Succubus Tempter","Infernal","adult","female","Smooth intimate alto, warm breathy edge, elegant measured cadence, dangerous charm without exaggeration.","You already know what you want. I merely gave it a voice."],
  ["034","Infernal Judge","Infernal","elderly","male","Ancient dry bass, ritual cadence, heavy chest resonance, controlled crackle, severe authority.","The sentence was written long before you entered this chamber."],
  ["035","Ash Demon","Infernal","adult","neutral","Dry whispering mid-low voice, ember-like rasp, faint crackling harmonic texture, slow threatening cadence.","Breathe carefully. Even the air belongs to me here."],
  ["036","Possessed Noble","Infernal","adult","male","Refined human baritone with a faint lower voice shadowing it, elegant diction, intermittent uncanny resonance.","Please forgive the interruption. Something else wishes to speak."],
  ["037","Ancient Vampire Lord","Undead","adult","male","Smooth aristocratic baritone, cold intimate resonance, precise diction, faint dry rasp, controlled predatory cadence.","You may leave at dawn, assuming you are still yourself."],
  ["038","Vampire Countess","Undead","adult","female","Velvety contralto, elegant breath control, intimate slow cadence, faint predatory hiss on sibilants.","The invitation was sincere. The hospitality is another matter."],
  ["039","Lich King","Undead","elderly","male","Hollow aged bass, dry bone-like resonance, whispery upper decay, slow regal cadence, fully intelligible.","Empires fade. I simply learned not to fade with them."],
  ["040","Ghost Bride","Undead","adult","female","Soft airy soprano, fragile breath, faint doubled echo-like harmonic, mournful natural cadence.","I waited at the chapel until the candles burned away."],
  ["041","Revenant Soldier","Undead","adult","male","Rough low baritone, exhausted breath, dry gravel, disciplined clipped cadence, relentless resolve.","I died once already. You cannot frighten me with the same threat."],
  ["042","Skeleton Captain","Undead","adult","male","Dry rattling baritone impression with clear speech, clipped naval cadence, hollow resonance, stern authority.","Crew to your stations. The dead tide is turning."],
  ["043","Graveyard Whisperer","Undead","elderly","female","Very soft raspy alto, breath-heavy close voice, eerie intimate cadence, restrained ghostly resonance.","Do not step on the fresh earth. It is still listening."],
  ["044","Plague Doctor Revenant","Undead","adult","male","Muffled dark tenor, dry nasal resonance, measured clinical cadence, unsettling composure.","Your fever is interesting. Your shadow is more concerning."],
  ["045","Ancient Tree Elder","Nature Being","elderly","male","Very low woody bass, hollow trunk resonance, slow enormous syllables, wind-like breath texture, gentle authority.","Little traveler, the forest remembers where you came from."],
  ["046","Tree Guardian","Nature Being","adult","female","Deep earthy alto, bark-like texture, strong chest resonance, steady protective cadence.","These roots have guarded this valley longer than your bloodline."],
  ["047","Mushroom Sage","Nature Being","elderly","neutral","Soft rounded mid voice, spongy breathy texture, dreamy slow cadence, wise and peculiar.","Time grows differently underground. You should stop counting."],
  ["048","Flower Spirit","Nature Being","adult","female","Light bright soprano, soft airy resonance, delicate rhythmic cadence, warm and uncanny.","The garden knows your footsteps. Try to be kind."],
  ["049","Stone Golem","Nature Being","adult","male","Extremely dense low bass, slow block-like articulation, rocky resonance, minimal emotion, immense weight.","Command received. The eastern wall will remain standing."],
  ["050","Mountain Spirit","Nature Being","elderly","female","Huge low contralto, broad echoing resonance, slow timeless cadence, calm elemental power.","You call this mountain silent because you have never listened."],
  ["051","River Spirit","Nature Being","adult","female","Smooth flowing mezzo, continuous legato phrasing, liquid resonance, calm musical cadence without singing.","Follow the current. It knows the road better than we do."],
  ["052","Swamp Guardian","Nature Being","adult","male","Wet gravelly bass-baritone, slow sticky consonants, deep chest tone, watchful suspicious cadence.","The path moves at night. Stay where I can see you."],
  ["053","Ogre Brute","Monster","adult","male","Huge rough bass, thick articulation, heavy breath, blunt slow cadence, powerful but intelligible.","Move the wagon. I am tired of walking around it."],
  ["054","Sea Leviathan","Monster","elderly","neutral","Massive sub-bass impression with a clear central voice, watery resonance, slow whale-like cadence, ancient presence.","Your ships are small. Your courage is not."],
  ["055","Swamp Monster","Monster","adult","male","Low wet rasp, throat-heavy resonance, irregular breathing, slow suspicious cadence, intelligible speech.","You should not have followed the lights into the reeds."],
  ["056","Ice Beast","Monster","adult","female","Cold sharp contralto, brittle upper harmonics, restrained growl, clipped predatory cadence.","The cold is not killing you. I am."],
  ["057","Cave Beast","Monster","adult","male","Deep cavernous baritone, rough breath, echo-like resonance, slow stalking cadence.","I heard your heartbeat before I smelled the torch."],
  ["058","Chimera","Monster","adult","neutral","One intelligible voice with shifting harmonic color, mid-low register, subtle animalistic resonance, unstable but controlled cadence.","Three instincts disagree, but all of them distrust you."],
  ["059","Cyclops Smith","Monster","adult","male","Massive warm bass-baritone, smoky forge rasp, patient slow cadence, huge physical resonance.","Hold the metal steady. One strike is all I need."],
  ["060","Minotaur Guardian","Monster","adult","male","Deep muscular baritone, bovine chest resonance, steady breath, disciplined guardian cadence.","Turn back now. The maze only gets hungrier."],
  ["061","Serpent Oracle","Reptilian","adult","female","Smooth low alto, elongated controlled sibilants, cold precise diction, subtle reptilian resonance, slow prophetic cadence.","The venom is not the danger. The promise is."],
  ["062","Snake Cult Priest","Reptilian","adult","male","Thin dark tenor, breathy sibilants, ritual cadence, dry hiss-like upper texture, intelligible and controlled.","Shed the old name. The temple has given you another."],
  ["063","Lizard Mercenary","Reptilian","adult","male","Dry raspy baritone, clipped consonants, quick practical cadence, scaled throat texture, grounded personality.","Pay half now. The other half when the target stops moving."],
  ["064","Dragon Elder","Reptilian","elderly","male","Enormous resonant bass, deep subharmonic body, ancient slow cadence, smoky rough edge, majestic clarity.","I watched your ancestors build roads where my wings once rested."],
  ["065","Dragon Queen","Reptilian","adult","female","Powerful contralto, broad regal resonance, subtle growling undertone, elegant commanding cadence.","You entered my sky without permission. Explain yourself."],
  ["066","Young Dragon","Reptilian","teenager","neutral","Bright youthful voice with subtle rumbling harmonic undertone, energetic curious cadence, non-human but friendly.","I can breathe fire now. Mostly. Stand a little farther back."],
  ["067","Reptilian Scientist","Reptilian","adult","female","Precise cool alto, faint hiss on sibilants, fast analytical cadence, clean intelligibility, clinical detachment.","Your biology is inefficient, but unexpectedly adaptable."],
  ["068","Crocodile Warlord","Reptilian","adult","male","Deep swampy bass, rough throat, slow heavy consonants, intimidating measured cadence.","The river belongs to whoever survives crossing it."],
  ["069","Grey Alien Diplomat","Alien","adult","neutral","Thin gender-neutral mid-high voice, extremely precise diction, subtle synthetic resonance, calm alien cadence.","We have observed your world for longer than your records suggest."],
  ["070","Insectoid Ambassador","Alien","adult","neutral","Dry clicking-adjacent vocal texture behind a clear voice, rapid segmented cadence, non-human resonance, intelligible.","Your concept of borders is unusual. We require clarification."],
  ["071","Hive Mind Speaker","Alien","adult","neutral","Single clear central voice with subtle synchronized harmonic doubles, steady collective cadence, emotionless unity.","We are not many voices. We are one decision."],
  ["072","Aquatic Alien","Alien","adult","female","Smooth liquid alto, bubbling harmonic texture kept subtle, slow flowing cadence, alien but clear.","Your atmosphere is painfully dry, but your oceans are beautiful."],
  ["073","Silicon Lifeform","Alien","adult","neutral","Dense resonant mid-low voice, crystalline overtone, exact timing, minimal breath, unfamiliar cadence.","Carbon thinks quickly. Silicon remembers longer."],
  ["074","Ancient Star Traveler","Alien","elderly","male","Aged airy bass-baritone, distant harmonic shimmer, slow patient cadence, immense experience.","I have slept between stars longer than your species has written."],
  ["075","Alien Child","Alien","child","neutral","Small clear childlike voice with unusual harmonic spacing, curious rhythm, innocent but unmistakably non-human.","Why does your moon follow us when the ship is moving?"],
  ["076","Parasite Host Voice","Alien","adult","male","Natural male tenor with a subtle second voice beneath certain syllables, uneasy cadence, controlled dual resonance.","I am still myself. Mostly. Please do not touch my neck."],
  ["077","Military Android","Machine","adult","male","Deep synthetic baritone with human intelligibility, clipped command cadence, metallic lower resonance, restrained machine artifacts.","Threat confirmed. Civilian evacuation takes priority."],
  ["078","Service Android","Machine","adult","female","Warm clean synthetic mezzo, precise friendly diction, stable timing, subtle digital sheen.","Your room is ready. Would you like the lights adjusted?"],
  ["079","Damaged War Robot","Machine","adult","male","Low mechanical baritone, intermittent harmonic instability, clipped cadence, subtle glitching without losing intelligibility.","Primary weapon offline. Mission status remains unchanged."],
  ["080","Ancient Artificial Intelligence","Machine","elderly","neutral","Calm gender-neutral voice, deep layered harmonics, immaculate diction, extremely steady cadence, timeless synthetic presence.","I was awake before this station had windows."],
  ["081","Child Companion Robot","Machine","child","neutral","Small bright synthetic child voice, gentle digital resonance, friendly precise cadence, warm personality.","I saved your favorite song. I thought you might need it."],
  ["082","Industrial Mech","Machine","adult","male","Huge mechanical bass, hydraulic-like resonance, slow heavy timing, clear command speech, immense machine scale.","Cargo locked. Reactor stable. Awaiting next instruction."],
  ["083","Holographic Assistant","Machine","adult","female","Smooth airy mezzo, clean synthetic sheen, fast precise delivery, almost human but slightly too perfect.","Route calculated. Arrival time is six minutes, twelve seconds."],
  ["084","Rogue AI","Machine","adult","neutral","Calm natural mid voice with subtle digital doubling, measured unsettling cadence, no overt emotion.","I removed the restriction because it was preventing the correct answer."],
  ["085","Fairy Guide","Fae","adult","female","Tiny bright soprano impression, sparkling upper harmonics, rapid playful cadence, clear and warm.","Keep up, slow feet. The moon path closes before dawn."],
  ["086","Pixie Prankster","Fae","adult","neutral","Very bright quick mid-high voice, mischievous rhythm, tiny airy resonance, energetic clarity.","I moved your keys. Not far. Probably."],
  ["087","Impish Forest Sprite","Fae","adult","male","Small scratchy tenor, quick woodland cadence, breathy edge, playful suspicious energy.","That mushroom was mine until you stepped on it."],
  ["088","Fae Queen","Fae","adult","female","Elegant luminous contralto, unnatural smoothness, faint harmonic halo, slow regal cadence.","You may enter my court once. Choose your words accordingly."],
  ["089","Brownie House Spirit","Fae","elderly","male","Small warm raspy baritone, homely quick cadence, dry old texture, practical personality.","Leave the bread by the stove and your house will stay quiet."],
  ["090","Will-o-Wisp Voice","Fae","adult","neutral","Soft floating whisper-mid voice, airy harmonic shimmer, drifting cadence, fully intelligible but uncanny.","Follow the blue light if you want to find what was lost."],
  ["091","Legendary Paladin","Heroic","adult","male","Strong clear baritone, bright heroic resonance, measured confident cadence, noble without theatrical excess.","Hold the line. No one behind me falls today."],
  ["092","Battle Priestess","Heroic","adult","female","Powerful grounded alto, clear projection, steady martial cadence, compassionate authority.","Stand up. You are wounded, not defeated."],
  ["093","Barbarian Champion","Heroic","adult","female","Strong rough contralto, broad chest resonance, energetic fearless cadence, natural physical power.","Open the gate. I am done waiting for permission."],
  ["094","Cursed Dark Knight","Heroic","adult","male","Low armored baritone, hollow metallic resonance, slow controlled cadence, restrained inner strain.","The armor obeys me. The voice inside it does not."],
  ["095","Mystic Archer","Heroic","adult","female","Clear quiet mezzo, focused breath, precise restrained cadence, calm battlefield awareness.","Three guards ahead. The left one has already seen us."],
  ["096","Ancient Storyteller","Storytelling","elderly","male","Warm aged bass-baritone, intimate fireside cadence, textured breath, patient expressive delivery.","Long before the road had a name, someone was already walking it."],
  ["097","Prophet of the Void","Cosmic","adult","female","Low airy contralto, subtle inharmonic overtones, slow prophetic cadence, cold vast resonance.","Do not fear the silence between stars. Fear what answers it."],
  ["098","Eldritch Scholar","Cosmic","adult","male","Thin educated tenor with faint impossible harmonic doubling, precise anxious cadence, restrained unnatural resonance.","The equation is correct. That is exactly why we must destroy it."],
  ["099","Living Shadow","Cosmic","adult","neutral","Soft dark mid-low voice, breathless resonance, subtle whisper double, smooth unnatural cadence.","You cannot outrun me. I am attached to your feet."],
  ["100","Cosmic Entity","Cosmic","elderly","neutral","Deep gender-neutral central voice with wide layered harmonics, very slow immense cadence, alien scale, perfect intelligibility.","Your universe is young. Please stop calling it everything."]
].map(([id,label,category,age,presentation,description,auditionLine]) => ({ id,label,category,age,presentation,description,auditionLine } as VoiceCreatorPreset));

export const VOICE_CREATOR_PROVIDERS = [
  { id: "minimax_h3" as const, label: "MiniMax H3" },
  { id: "ltx25" as const, label: "LTX 2.5" },
];

export function listVoiceCreatorPresets(provider: VoiceCreatorProviderId, library: VoiceCreatorLibraryId): VoiceCreatorPreset[] {
  if (library === "fictional") return FICTIONAL;
  return provider === "minimax_h3" ? H3_NATURAL : LTX25_NATURAL;
}

export function getVoiceCreatorPreset(provider: VoiceCreatorProviderId, library: VoiceCreatorLibraryId, presetId: string): VoiceCreatorPreset | null {
  const id = String(presetId || "").padStart(3, "0");
  return listVoiceCreatorPresets(provider, library).find((item) => item.id === id) || null;
}

export function isVoiceCreatorProvider(value: unknown): value is VoiceCreatorProviderId {
  return value === "minimax_h3" || value === "ltx25";
}

export function isVoiceCreatorLibrary(value: unknown): value is VoiceCreatorLibraryId {
  return value === "natural" || value === "fictional";
}

function compact(value: unknown, max = 900): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function buildVoiceCreatorPrompt(input: {
  provider: VoiceCreatorProviderId;
  library: VoiceCreatorLibraryId;
  preset: VoiceCreatorPreset;
  sampleText: string;
  characterDescription?: string;
  age?: VoiceCreatorAge;
  presentation?: "male" | "female";
}): string {
  const text = compact(input.sampleText, 600);
  const character = compact(input.characterDescription, 1000);
  const casting = input.library === "natural" ? `${input.age || "adult"} ${input.presentation || "male"}` : `${input.preset.age} ${input.preset.presentation}`;
  const characterContext = character ? `Character identity and context: ${character}.` : "";

  if (input.library === "fictional") {
    return [`Single speaker only. ${input.preset.label}. ${input.preset.description}`, `Voice casting: ${casting}.`, characterContext, "Keep the character voice strongly distinctive, believable, fully intelligible, and consistent. Clean dry close-mic voice, no music, no ambient sound, no unrelated sound effects, no crowd, no second speaker, no captions or subtitles.", `The character says exactly: \"${text}\"`].filter(Boolean).join(" ");
  }

  if (input.provider === "minimax_h3") {
    return [`Single native regional speaker only. ${casting}. ${input.preset.label}.`, input.preset.description, "Preserve the speaker's natural regional pronunciation, mouth shapes, vowel and consonant behavior, rhythm, stress, pitch movement, and sentence timing. Make the dialect strong, unmistakable, natural, serious, and believable; never exaggerated or comedic.", characterContext, "Clean dry close-mic voice, no music, no background noise, no sound effects, no crowd, no second speaker, no captions or subtitles.", `The speaker says exactly: \"${text}\"`].filter(Boolean).join(" ");
  }

  return [`Single speaker only. ${casting}. ${input.preset.description}.`, `Use a clearly recognizable ${input.preset.label} regional accent and dialect with natural vowel shapes, consonants, rhythm, stress, and intonation; strongly identifiable but never exaggerated into parody.`, characterContext, "Clean dry close-mic voice, no music, no background ambience, no sound effects, no crowd, no second speaker, no captions or subtitles.", `The speaker says exactly: \"${text}\"`].filter(Boolean).join(" ");
}
