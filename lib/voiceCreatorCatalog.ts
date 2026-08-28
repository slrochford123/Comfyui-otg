export type VoiceCreatorProviderId = "ltx25";
export type VoiceCreatorLibraryId = "natural" | "fictional";
export type VoiceCreatorAge = "adult" | "elderly" | "teenager" | "child" | "unspecified";
export type VoiceCreatorPresentation = "male" | "female" | "neutral" | "unspecified";

export type VoiceCreatorPreset = {
  id: string;
  label: string;
  category: string;
  age: string;
  presentation: string;
  description: string;
  auditionLine: string;
};

const LTX25_NATURAL: VoiceCreatorPreset[] = [
  {"id": "001", "label": "General American", "category": "United States", "age": "adult", "presentation": "unspecified", "description": "General American English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "002", "label": "Southern US - Georgia", "category": "United States", "age": "adult", "presentation": "unspecified", "description": "Georgia Southern American English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "003", "label": "Texas", "category": "United States", "age": "adult", "presentation": "unspecified", "description": "Texas English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "004", "label": "New York City", "category": "United States", "age": "adult", "presentation": "unspecified", "description": "New York City English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "005", "label": "Boston", "category": "United States", "age": "adult", "presentation": "unspecified", "description": "Boston English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "006", "label": "Philadelphia", "category": "United States", "age": "adult", "presentation": "unspecified", "description": "Philadelphia English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "007", "label": "Chicago / Inland North", "category": "United States", "age": "adult", "presentation": "unspecified", "description": "Inland North American English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "008", "label": "Minnesota / Upper Midwest", "category": "United States", "age": "adult", "presentation": "unspecified", "description": "Upper Midwestern American English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "009", "label": "Appalachian", "category": "United States", "age": "adult", "presentation": "unspecified", "description": "Appalachian English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "010", "label": "California", "category": "United States", "age": "adult", "presentation": "unspecified", "description": "California English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "011", "label": "Pacific Northwest", "category": "United States", "age": "adult", "presentation": "unspecified", "description": "Pacific Northwest English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "012", "label": "New Orleans", "category": "United States", "age": "adult", "presentation": "unspecified", "description": "New Orleans English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "013", "label": "Cajun Louisiana", "category": "United States", "age": "adult", "presentation": "unspecified", "description": "Cajun English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "014", "label": "Pittsburgh", "category": "United States", "age": "adult", "presentation": "unspecified", "description": "Pittsburgh English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "015", "label": "Hawaii", "category": "United States", "age": "adult", "presentation": "unspecified", "description": "Hawaii English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "016", "label": "England", "category": "England", "age": "adult", "presentation": "unspecified", "description": "English accent from England", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "017", "label": "Scotland", "category": "Scotland", "age": "adult", "presentation": "unspecified", "description": "Scottish English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "018", "label": "Wales", "category": "Wales", "age": "adult", "presentation": "unspecified", "description": "Welsh English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "019", "label": "Northern Ireland", "category": "Northern Ireland", "age": "adult", "presentation": "unspecified", "description": "Northern Irish English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "020", "label": "Ireland", "category": "Ireland", "age": "adult", "presentation": "unspecified", "description": "Irish English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "021", "label": "Canada", "category": "Canada", "age": "adult", "presentation": "unspecified", "description": "Canadian English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "022", "label": "Australia", "category": "Australia", "age": "adult", "presentation": "unspecified", "description": "Australian English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "023", "label": "New Zealand", "category": "New Zealand", "age": "adult", "presentation": "unspecified", "description": "New Zealand English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "024", "label": "Jamaica", "category": "Jamaica", "age": "adult", "presentation": "unspecified", "description": "Jamaican English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "025", "label": "Trinidad and Tobago", "category": "Trinidad and Tobago", "age": "adult", "presentation": "unspecified", "description": "Trinidadian and Tobagonian English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "026", "label": "Guyana", "category": "Guyana", "age": "adult", "presentation": "unspecified", "description": "Guyanese English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "027", "label": "Barbados", "category": "Barbados", "age": "adult", "presentation": "unspecified", "description": "Barbadian English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "028", "label": "Bahamas", "category": "Bahamas", "age": "adult", "presentation": "unspecified", "description": "Bahamian English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "029", "label": "Belize", "category": "Belize", "age": "adult", "presentation": "unspecified", "description": "Belizean English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "030", "label": "South Africa", "category": "South Africa", "age": "adult", "presentation": "unspecified", "description": "South African English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "031", "label": "Nigeria", "category": "Nigeria", "age": "adult", "presentation": "unspecified", "description": "Nigerian English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "032", "label": "Ghana", "category": "Ghana", "age": "adult", "presentation": "unspecified", "description": "Ghanaian English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "033", "label": "Kenya", "category": "Kenya", "age": "adult", "presentation": "unspecified", "description": "Kenyan English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "034", "label": "Uganda", "category": "Uganda", "age": "adult", "presentation": "unspecified", "description": "Ugandan English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "035", "label": "Tanzania", "category": "Tanzania", "age": "adult", "presentation": "unspecified", "description": "Tanzanian English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "036", "label": "Zimbabwe", "category": "Zimbabwe", "age": "adult", "presentation": "unspecified", "description": "Zimbabwean English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "037", "label": "Ethiopia", "category": "Ethiopia", "age": "adult", "presentation": "unspecified", "description": "Ethiopian-accented English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "038", "label": "Egypt", "category": "Egypt", "age": "adult", "presentation": "unspecified", "description": "Egyptian Arabic-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "039", "label": "Morocco", "category": "Morocco", "age": "adult", "presentation": "unspecified", "description": "Moroccan Arabic-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "040", "label": "Lebanon", "category": "Lebanon", "age": "adult", "presentation": "unspecified", "description": "Lebanese Arabic-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "041", "label": "Israel", "category": "Israel", "age": "adult", "presentation": "unspecified", "description": "Israeli Hebrew-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "042", "label": "Turkey", "category": "Turkey", "age": "adult", "presentation": "unspecified", "description": "Turkish-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "043", "label": "Greece", "category": "Greece", "age": "adult", "presentation": "unspecified", "description": "Greek-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "044", "label": "Italy", "category": "Italy", "age": "adult", "presentation": "unspecified", "description": "Italian-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "045", "label": "France", "category": "France", "age": "adult", "presentation": "unspecified", "description": "French-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "046", "label": "Spain", "category": "Spain", "age": "adult", "presentation": "unspecified", "description": "Spanish-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "047", "label": "Portugal", "category": "Portugal", "age": "adult", "presentation": "unspecified", "description": "Portuguese-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "048", "label": "Germany", "category": "Germany", "age": "adult", "presentation": "unspecified", "description": "German-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "049", "label": "Netherlands", "category": "Netherlands", "age": "adult", "presentation": "unspecified", "description": "Dutch-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "050", "label": "Belgium", "category": "Belgium", "age": "adult", "presentation": "unspecified", "description": "Belgian-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "051", "label": "Switzerland", "category": "Switzerland", "age": "adult", "presentation": "unspecified", "description": "Swiss-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "052", "label": "Austria", "category": "Austria", "age": "adult", "presentation": "unspecified", "description": "Austrian German-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "053", "label": "Poland", "category": "Poland", "age": "adult", "presentation": "unspecified", "description": "Polish-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "054", "label": "Czechia", "category": "Czechia", "age": "adult", "presentation": "unspecified", "description": "Czech-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "055", "label": "Hungary", "category": "Hungary", "age": "adult", "presentation": "unspecified", "description": "Hungarian-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "056", "label": "Romania", "category": "Romania", "age": "adult", "presentation": "unspecified", "description": "Romanian-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "057", "label": "Bulgaria", "category": "Bulgaria", "age": "adult", "presentation": "unspecified", "description": "Bulgarian-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "058", "label": "Serbia", "category": "Serbia", "age": "adult", "presentation": "unspecified", "description": "Serbian-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "059", "label": "Croatia", "category": "Croatia", "age": "adult", "presentation": "unspecified", "description": "Croatian-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "060", "label": "Ukraine", "category": "Ukraine", "age": "adult", "presentation": "unspecified", "description": "Ukrainian-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "061", "label": "Russia", "category": "Russia", "age": "adult", "presentation": "unspecified", "description": "Russian-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "062", "label": "Lithuania", "category": "Lithuania", "age": "adult", "presentation": "unspecified", "description": "Lithuanian-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "063", "label": "Latvia", "category": "Latvia", "age": "adult", "presentation": "unspecified", "description": "Latvian-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "064", "label": "Estonia", "category": "Estonia", "age": "adult", "presentation": "unspecified", "description": "Estonian-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "065", "label": "Finland", "category": "Finland", "age": "adult", "presentation": "unspecified", "description": "Finnish-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "066", "label": "Sweden", "category": "Sweden", "age": "adult", "presentation": "unspecified", "description": "Swedish-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "067", "label": "Norway", "category": "Norway", "age": "adult", "presentation": "unspecified", "description": "Norwegian-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "068", "label": "Denmark", "category": "Denmark", "age": "adult", "presentation": "unspecified", "description": "Danish-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "069", "label": "Iceland", "category": "Iceland", "age": "adult", "presentation": "unspecified", "description": "Icelandic-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "070", "label": "Georgia - Country", "category": "Georgia", "age": "adult", "presentation": "unspecified", "description": "Georgian-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "071", "label": "Armenia", "category": "Armenia", "age": "adult", "presentation": "unspecified", "description": "Armenian-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "072", "label": "India", "category": "India", "age": "adult", "presentation": "unspecified", "description": "Indian English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "073", "label": "Pakistan", "category": "Pakistan", "age": "adult", "presentation": "unspecified", "description": "Pakistani English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "074", "label": "Bangladesh", "category": "Bangladesh", "age": "adult", "presentation": "unspecified", "description": "Bangladeshi English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "075", "label": "Sri Lanka", "category": "Sri Lanka", "age": "adult", "presentation": "unspecified", "description": "Sri Lankan English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "076", "label": "Nepal", "category": "Nepal", "age": "adult", "presentation": "unspecified", "description": "Nepali-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "077", "label": "China - Mandarin", "category": "China", "age": "adult", "presentation": "unspecified", "description": "Mandarin Chinese-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "078", "label": "Hong Kong - Cantonese", "category": "Hong Kong", "age": "adult", "presentation": "unspecified", "description": "Cantonese-influenced Hong Kong English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "079", "label": "Japan", "category": "Japan", "age": "adult", "presentation": "unspecified", "description": "Japanese-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "080", "label": "South Korea", "category": "South Korea", "age": "adult", "presentation": "unspecified", "description": "Korean-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "081", "label": "Taiwan", "category": "Taiwan", "age": "adult", "presentation": "unspecified", "description": "Taiwan Mandarin-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "082", "label": "Vietnam", "category": "Vietnam", "age": "adult", "presentation": "unspecified", "description": "Vietnamese-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "083", "label": "Thailand", "category": "Thailand", "age": "adult", "presentation": "unspecified", "description": "Thai-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "084", "label": "Indonesia", "category": "Indonesia", "age": "adult", "presentation": "unspecified", "description": "Indonesian-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "085", "label": "Malaysia", "category": "Malaysia", "age": "adult", "presentation": "unspecified", "description": "Malaysian English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "086", "label": "Singapore", "category": "Singapore", "age": "adult", "presentation": "unspecified", "description": "Singapore English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "087", "label": "Philippines", "category": "Philippines", "age": "adult", "presentation": "unspecified", "description": "Filipino English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "088", "label": "Mexico", "category": "Mexico", "age": "adult", "presentation": "unspecified", "description": "Mexican Spanish-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "089", "label": "Cuba", "category": "Cuba", "age": "adult", "presentation": "unspecified", "description": "Cuban Spanish-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "090", "label": "Puerto Rico", "category": "Puerto Rico", "age": "adult", "presentation": "unspecified", "description": "Puerto Rican Spanish-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "091", "label": "Dominican Republic", "category": "Dominican Republic", "age": "adult", "presentation": "unspecified", "description": "Dominican Spanish-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "092", "label": "Colombia", "category": "Colombia", "age": "adult", "presentation": "unspecified", "description": "Colombian Spanish-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "093", "label": "Venezuela", "category": "Venezuela", "age": "adult", "presentation": "unspecified", "description": "Venezuelan Spanish-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "094", "label": "Brazil", "category": "Brazil", "age": "adult", "presentation": "unspecified", "description": "Brazilian Portuguese-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "095", "label": "Argentina", "category": "Argentina", "age": "adult", "presentation": "unspecified", "description": "Argentinian Spanish-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "096", "label": "Chile", "category": "Chile", "age": "adult", "presentation": "unspecified", "description": "Chilean Spanish-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "097", "label": "Peru", "category": "Peru", "age": "adult", "presentation": "unspecified", "description": "Peruvian Spanish-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "098", "label": "Ecuador", "category": "Ecuador", "age": "adult", "presentation": "unspecified", "description": "Ecuadorian Spanish-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "099", "label": "Costa Rica", "category": "Costa Rica", "age": "adult", "presentation": "unspecified", "description": "Costa Rican Spanish-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
  {"id": "100", "label": "Panama", "category": "Panama", "age": "adult", "presentation": "unspecified", "description": "Panamanian Spanish-influenced English", "auditionLine": "Please close the gate before dark, then call me when you arrive home."},
];

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
  { id: "ltx25" as const, label: "LTX 2.5" },
];

export function listVoiceCreatorPresets(
  provider: VoiceCreatorProviderId,
  library: VoiceCreatorLibraryId,
): VoiceCreatorPreset[] {
  void provider;
  return library === "fictional" ? FICTIONAL : LTX25_NATURAL;
}

export function getVoiceCreatorPreset(provider: VoiceCreatorProviderId, library: VoiceCreatorLibraryId, presetId: string): VoiceCreatorPreset | null {
  const id = String(presetId || "").padStart(3, "0");
  return listVoiceCreatorPresets(provider, library).find((item) => item.id === id) || null;
}

export function isVoiceCreatorProvider(
  value: unknown,
): value is VoiceCreatorProviderId {
  return value === "ltx25";
}

export function isVoiceCreatorLibrary(value: unknown): value is VoiceCreatorLibraryId {
  return value === "natural" || value === "fictional";
}

function compact(value: unknown, max = 900): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

const DEMOGRAPHIC_REGISTER_FRAGMENT = new RegExp(
  String.raw`\b(?:` +
    [
      "adult",
      "elderly",
      "older",
      "aged",
      "ancient",
      "young",
      "youthful",
      "child",
      "childlike",
      "male",
      "female",
      "gender[- ]neutral",
      "baritone",
      "bass(?:-baritone)?",
      "tenor",
      "alto",
      "contralto",
      "mezzo",
      "soprano",
      "mid[- ]high",
      "mid[- ]low",
      "low register",
      "mid register",
      "high register",
      "chest resonance",
      "deep chest",
      "sub-bass",
    ].join("|") +
    String.raw`)\b`,
  "i",
);

function sanitizeFictionalFragment(fragment: string): string {
  const value = compact(fragment, 500);
  if (!value) return "";
  if (!DEMOGRAPHIC_REGISTER_FRAGMENT.test(value)) return value;

  const withMatch = value.match(/\bwith\s+(.+)$/i);
  if (withMatch?.[1]) {
    return `voice with ${withMatch[1].trim()}`;
  }

  return "";
}

function sanitizePresetDescription(
  description: string,
  library: VoiceCreatorLibraryId,
): string {
  const value = compact(description, 1400);

  if (library === "natural") {
    return value
      .split(";")
      .map((fragment) => fragment.trim())
      .filter(
        (fragment) =>
          fragment.length > 0 &&
          !DEMOGRAPHIC_REGISTER_FRAGMENT.test(fragment),
      )
      .join("; ");
  }

  return value
    .split(",")
    .map(sanitizeFictionalFragment)
    .filter(Boolean)
    .join(", ");
}

function normalizeAge(value: unknown): VoiceCreatorAge {
  if (
    value === "child" ||
    value === "teenager" ||
    value === "adult" ||
    value === "elderly" ||
    value === "unspecified"
  ) {
    return value;
  }
  return "adult";
}

function normalizePresentation(
  value: unknown,
): VoiceCreatorPresentation {
  if (
    value === "male" ||
    value === "female" ||
    value === "neutral" ||
    value === "unspecified"
  ) {
    return value;
  }
  return "male";
}

function ageCastingGuidance(age: VoiceCreatorAge): string {
  switch (age) {
    case "child":
      return "child-aged voice with clearly childlike, age-appropriate vocal size, pitch behavior, and resonance";
    case "teenager":
      return "teenage voice with naturally adolescent vocal size, pitch behavior, and resonance";
    case "elderly":
      return "elderly voice with naturally age-appropriate vocal texture, timing, and resonance";
    case "unspecified":
      return "unspecified; leave the age impression open and do not impose a fixed age class";
    default:
      return "adult-aged voice with natural adult vocal qualities";
  }
}

function presentationCastingGuidance(
  presentation: VoiceCreatorPresentation,
): string {
  if (presentation === "neutral") {
    return "neutral, non-gendered voice presentation without forcing a masculine or feminine vocal register";
  }
  if (presentation === "unspecified") {
    return "unspecified; leave gender presentation open and do not impose a fixed gendered vocal register";
  }
  return `${presentation} voice presentation without imposing a fixed pitch or vocal register`;
}

function castingLabel(
  age: VoiceCreatorAge,
  presentation: VoiceCreatorPresentation,
): string {
  const ageLabel =
    age === "unspecified" ? "age-unspecified" : age;
  const presentationLabel =
    presentation === "neutral"
      ? "neutral-presenting"
      : presentation === "unspecified"
        ? "presentation-unspecified"
        : presentation;

  return `${ageLabel} ${presentationLabel}`;
}

function modelFacingFictionalIdentity(label: string): string {
  return compact(label, 160)
    .replace(/\b(?:Ancient|Young|Child|Elder)\b/gi, "")
    .replace(/\b(?:King|Queen)\b/gi, "Ruler")
    .replace(/\b(?:Prince|Princess)\b/gi, "Royal")
    .replace(/\b(?:Matriarch|Patriarch)\b/gi, "Leader")
    .replace(/\b(?:Priestess|Priest)\b/gi, "Cleric")
    .replace(/\b(?:Lord|Lady|Countess|Duke|Duchess)\b/gi, "Noble")
    .replace(/\b(?:Bride|Groom)\b/gi, "Apparition")
    .replace(/\b(?:Witch|Warlock)\b/gi, "Magic User")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildVoiceCreatorPrompt(input: {
  provider: VoiceCreatorProviderId;
  library: VoiceCreatorLibraryId;
  preset: VoiceCreatorPreset;
  sampleText: string;
  characterDescription?: string;
  age?: VoiceCreatorAge;
  presentation?: VoiceCreatorPresentation;
}): string {
  const text = compact(input.sampleText, 600);
  const age = normalizeAge(input.age || input.preset.age);
  const presentation = normalizePresentation(
    input.presentation || input.preset.presentation,
  );
  const ageGuidance = ageCastingGuidance(age);
  const presentationGuidance =
    presentationCastingGuidance(presentation);
  const selectedCasting = castingLabel(age, presentation);
  const traits = sanitizePresetDescription(
    input.preset.description,
    input.library,
  );

  if (input.library === "fictional") {
    const identity =
      modelFacingFictionalIdentity(input.preset.label) ||
      "fictional character";

    return [
      "Single speaker only.",
      `Generic on-screen speaker casting: ${selectedCasting} ${identity} voice subject.`,
      `Fictional voice identity: ${identity}.`,
      `Voice age: ${ageGuidance}.`,
      `Voice presentation: ${presentationGuidance}.`,
      traits
        ? `Fictional acoustic traits: ${traits}.`
        : "",
      "Keep the selected fictional or creature identity strongly distinctive, believable, fully intelligible, and consistent.",
      "Clean dry close-mic voice, no music, no ambient sound, no unrelated sound effects, no crowd, no second speaker, no captions or subtitles.",
      `The character says exactly: "${text}"`,
    ]
      .filter(Boolean)
      .join(" ");
  }

  const regionalTraits = traits
    ? `Regional speech traits: ${traits}.`
    : "";


  return [
    "Single native regional speaker only.",
    `Generic on-screen speaker casting: ${selectedCasting} human speaker using the ${input.preset.label} accent and dialect.`,
    `Voice age: ${ageGuidance}.`,
    `Voice presentation: ${presentationGuidance}.`,
    regionalTraits,
    `Use a clearly recognizable ${input.preset.label} regional accent and dialect with natural vowel shapes, consonants, rhythm, stress, and intonation; strongly identifiable but never exaggerated into parody.`,
    "Clean dry close-mic voice, no music, no background ambience, no sound effects, no crowd, no second speaker, no captions or subtitles.",
    `The speaker says exactly: "${text}"`,
  ]
    .filter(Boolean)
    .join(" ");
}
