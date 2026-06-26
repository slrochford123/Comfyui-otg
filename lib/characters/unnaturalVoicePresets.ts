import { DEFAULT_VOICE_SAMPLE_TEXT } from "@/lib/characters/voiceDesignModels";

export type UnnaturalVoiceCategory =
  | "Demonic / Infernal"
  | "Giants / Ogres / Trolls"
  | "Robots / Machines"
  | "Animals / Small Creatures"
  | "Aliens / Cosmic / Elemental"
  | "Nature / Spirits";

export type UnnaturalVoicePreset = {
  id: string;
  index: number;
  name: string;
  category: UnnaturalVoiceCategory;
  prompt: string;
  sampleLine: string;
  enabled: true;
};

export const UNNATURAL_VOICE_CATEGORIES = [
  "Demonic / Infernal",
  "Giants / Ogres / Trolls",
  "Robots / Machines",
  "Animals / Small Creatures",
  "Aliens / Cosmic / Elemental",
  "Nature / Spirits",
] as const satisfies readonly UnnaturalVoiceCategory[];

const SAMPLE_LINE = DEFAULT_VOICE_SAMPLE_TEXT;

// OTG_UNNATURAL_VOICES_P1: registry/UI only. Prompts are generated from the final uploaded LTX 2.3.1 JSON source.
export const UNNATURAL_VOICE_PRESETS = [
  {
    id: "abyss_demon",
    index: 1,
    name: "Abyss Demon",
    category: "Demonic / Infernal",
    prompt: "A Abyss Demon character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a tall, ancient demon rising from a bottomless black abyss. Its body is covered in cracked charcoal skin, faint ember veins, long jagged horns, and glowing eyes like burning coals deep underground. The creature feels enormous, predatory, and ancient, as if its voice comes from far below the earth.\n\nThe speaker has a deep abyss demon voice. The voice should sound extremely low, cavernous, dark, breathy, threatening, and supernatural. The delivery should be slow, heavy, and intimidating, with a deep rumble underneath every word.\n\nThe Abyss Demon clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "ancient_devil",
    index: 2,
    name: "Ancient Devil",
    category: "Demonic / Infernal",
    prompt: "A Ancient Devil character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines an old devil from a forgotten underworld court, dressed in torn royal robes, with curved horns, sharp teeth, wrinkled red skin, and eyes full of cruel intelligence. He is not wild or chaotic; he is controlled, clever, patient, and terrifyingly confident.\n\nThe speaker has an ancient devil voice. The voice should sound old, wicked, raspy, dry, elegant, sinister, and intelligent. The delivery should feel calm and dangerous, like a villain who never needs to shout because he already owns the room.\n\nThe Ancient Devil clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "demon_king",
    index: 3,
    name: "Demon King",
    category: "Demonic / Infernal",
    prompt: "A Demon King character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a towering demon king seated on a black iron throne, wearing dark armor, cracked obsidian horns, glowing red eyes, and a burning crown. He looks massive, royal, violent, and impossible to challenge, like a ruler of an underworld empire.\n\nThe speaker has a demon king voice. The voice should sound huge, deep, commanding, evil, royal, loud, dark, and powerful. The delivery should be slow and dominant, with heavy authority and a deep chest resonance that makes every word feel like an order.\n\nThe Demon King clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "demon_queen",
    index: 4,
    name: "Demon Queen",
    category: "Demonic / Infernal",
    prompt: "A Demon Queen character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a terrifying demon queen standing in a ruined palace, wearing a jagged black crown, flowing crimson robes, sharp golden claws, elegant horns, and glowing eyes filled with cold power. She is beautiful, dangerous, regal, and merciless.\n\nThe speaker has a demon queen voice. The voice should sound feminine, dark, royal, seductive, sharp, commanding, and supernatural. The delivery should be smooth and controlled, with icy confidence, elegant cruelty, and emotional intensity underneath every word.\n\nThe Demon Queen clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "ancient_cyclops",
    index: 5,
    name: "Ancient Cyclops",
    category: "Giants / Ogres / Trolls",
    prompt: "A Ancient Cyclops character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a massive one-eyed cyclops standing inside a ruined mountain fortress. He has weathered gray skin, a single glowing eye, broken armor, huge hands, and the slow presence of a giant who has survived ancient wars.\n\nThe speaker has an ancient cyclops voice. The voice should sound enormous, old, blunt, heavy, gravelly, and battle-worn. The delivery should be slow, loud, simple, and forceful, with the weight of a giant behind every word.\n\nThe Ancient Cyclops clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "deep_cave_troll",
    index: 6,
    name: "Deep Cave Troll",
    category: "Giants / Ogres / Trolls",
    prompt: "A Deep Cave Troll character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a pale troll from far beneath the earth, with long arms, heavy shoulders, glowing yellow eyes, wet stone skin, and jagged teeth. It lives in darkness and sounds like it has not spoken to humans in centuries.\n\nThe speaker has a deep cave troll voice. The voice should sound low, wet, guttural, slow, suspicious, and ugly. The delivery should be lumbering and irritated, with a throat-heavy growl and a dark underground resonance.\n\nThe Deep Cave Troll clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "frost_giant",
    index: 7,
    name: "Frost Giant",
    category: "Giants / Ogres / Trolls",
    prompt: "A Frost Giant character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a towering frost giant standing on a frozen battlefield, with icy blue skin, a white beard frozen into spikes, crystal armor, and cold breath drifting from his mouth. He feels ancient, huge, and merciless.\n\nThe speaker has a frost giant voice. The voice should sound huge, deep, cold, stern, thunderous, and icy. The delivery should be slow and commanding, with a frozen hardness and a giant echo in every word.\n\nThe Frost Giant clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "iron_jaw_ogre",
    index: 8,
    name: "Iron Jaw Ogre",
    category: "Giants / Ogres / Trolls",
    prompt: "A Iron Jaw Ogre character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a huge ogre with a metal jaw bolted into his face, scarred skin, iron teeth, heavy armor scraps, and a brutal soldier-like posture. He looks like a monster built for war and pain.\n\nThe speaker has an iron jaw ogre voice. The voice should sound deep, metallic, clenched, brutal, grinding, and violent. The delivery should be aggressive and heavy, with words forced through a hard iron mouth.\n\nThe Iron Jaw Ogre clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "war_ogre",
    index: 9,
    name: "War Ogre",
    category: "Giants / Ogres / Trolls",
    prompt: "A War Ogre character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a huge war ogre charging through smoke and broken shields, wearing dented armor, holding a massive club, with scars across his face and rage in his eyes.\n\nThe speaker has a war ogre voice. The voice should sound loud, deep, angry, brutal, commanding, and violent. The delivery should be forceful and battle-ready, like a monster shouting orders before smashing through a gate.\n\nThe War Ogre clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "broken_service_robot",
    index: 10,
    name: "Broken Service Robot",
    category: "Robots / Machines",
    prompt: "A Broken Service Robot character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines an outdated service robot in a dusty hallway, with chipped white plating, flickering eye lights, stiff arms, and a polite expression stuck on a damaged metal face.\n\nThe speaker has a broken service robot voice. The voice should sound polite, mechanical, tired, glitchy, uneven, and slightly damaged. The delivery should try to sound helpful, but with small stutters, clipped timing, and worn-out artificial cheer.\n\nThe Broken Service Robot clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "friendly_toy_robot",
    index: 11,
    name: "Friendly Toy Robot",
    category: "Robots / Machines",
    prompt: "A Friendly Toy Robot character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a small colorful toy robot on a child's bedroom floor, with round glowing eyes, plastic arms, a painted smile, and cheerful little movements.\n\nThe speaker has a friendly toy robot voice. The voice should sound small, bright, cheerful, artificial, cute, and playful. The delivery should be upbeat and clear, like a happy electronic toy trying very hard to be friendly.\n\nThe Friendly Toy Robot clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "glitching_cyborg",
    index: 12,
    name: "Glitching Cyborg",
    category: "Robots / Machines",
    prompt: "A Glitching Cyborg character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a half-human, half-machine cyborg with a damaged metal skull plate, one human eye, one digital eye, exposed circuitry, and unstable neon pulses across the body.\n\nThe speaker has a glitching cyborg voice. The voice should sound half-human, half-machine, tense, digital, fragmented, and unstable. The delivery should shift between natural speech and artificial distortion, while remaining clear enough to understand.\n\nThe Glitching Cyborg clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "haunted_radio_voice",
    index: 13,
    name: "Haunted Radio Voice",
    category: "Robots / Machines",
    prompt: "A Haunted Radio Voice character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines an old wooden radio sitting alone in a dark room, its dial glowing faintly while a ghostly presence speaks through static from another time.\n\nThe speaker has a haunted radio voice. The voice should sound distant, eerie, thin, crackly, old-fashioned, ghostly, and unsettling. The delivery should feel like a mysterious broadcast coming through from a haunted frequency.\n\nThe Haunted Radio Voice clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "war_machine",
    index: 14,
    name: "War Machine",
    category: "Robots / Machines",
    prompt: "A War Machine character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a massive armored war machine standing on a battlefield, with heavy metal plating, glowing weapon systems, hydraulic limbs, and a voice system built to command armies.\n\nThe speaker has a war machine voice. The voice should sound huge, metallic, militarized, aggressive, heavy, and authoritative. The delivery should be direct and powerful, like a combat machine issuing a battlefield declaration.\n\nThe War Machine clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "ancient_turtle_sage",
    index: 15,
    name: "Ancient Turtle Sage",
    category: "Animals / Small Creatures",
    prompt: "A Ancient Turtle Sage character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a very old giant turtle sitting beside a quiet moonlit pond, with a moss-covered shell, wise cloudy eyes, slow blinking movements, and the calm presence of a creature that has watched centuries pass.\n\nThe speaker has an ancient turtle sage voice. The voice should sound elderly, slow, warm, wise, gentle, breathy, and deeply patient. The delivery should be calm and deliberate, like every word has been carefully chosen after a hundred years of thought.\n\nThe Ancient Turtle Sage clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "deep_voiced_bear",
    index: 16,
    name: "Deep-Voiced Bear",
    category: "Animals / Small Creatures",
    prompt: "A Deep-Voiced Bear character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a massive old bear standing in a pine forest, with dark fur, heavy paws, scars across his muzzle, and calm powerful eyes. He feels protective, dangerous, and grounded.\n\nThe speaker has a deep-voiced bear voice. The voice should sound very low, warm, heavy, growling, protective, and earthy. The delivery should be slow and strong, like a massive animal speaking with restrained strength.\n\nThe Deep-Voiced Bear clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "grumpy_toad",
    index: 17,
    name: "Grumpy Toad",
    category: "Animals / Small Creatures",
    prompt: "A Grumpy Toad character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a squat old toad sitting on a damp stone beside a swamp, with bumpy green skin, a wide frowning mouth, sleepy eyes, and an annoyed expression.\n\nThe speaker has a grumpy toad voice. The voice should sound croaky, wet, low, nasal, cranky, and irritated. The delivery should be grumbling and stubborn, like a small swamp creature complaining about being disturbed.\n\nThe Grumpy Toad clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "high_strung_squirrel",
    index: 18,
    name: "High-Strung Squirrel",
    category: "Animals / Small Creatures",
    prompt: "A High-Strung Squirrel character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a tiny nervous squirrel on a tree branch, with twitching whiskers, wide eyes, tiny paws, a flicking tail, and a frantic alertness like it has had too much energy.\n\nThe speaker has a high-strung squirrel voice. The voice should sound small, fast, squeaky, anxious, jumpy, bright, and hyperactive. The delivery should be quick and nervous, as if every word is racing ahead before the next thought arrives.\n\nThe High-Strung Squirrel clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "parrot_pirate_captain",
    index: 19,
    name: "Parrot Pirate Captain",
    category: "Animals / Small Creatures",
    prompt: "A Parrot Pirate Captain character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a colorful parrot pirate captain perched on a ship wheel, with bright feathers, a tiny captain hat, sharp eyes, and theatrical confidence on a moonlit pirate deck.\n\nThe speaker has a parrot pirate captain voice. The voice should sound squawky, loud, sharp, comic, bossy, and theatrical. The delivery should be bold and pirate-like, with an energetic bird quality and a captain's swagger.\n\nThe Parrot Pirate Captain clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "rat_king",
    index: 20,
    name: "Rat King",
    category: "Animals / Small Creatures",
    prompt: "A Rat King character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a filthy rat king standing in a sewer throne room, wearing a tiny broken crown, surrounded by shadows, with yellow teeth, twitching whiskers, and greedy intelligent eyes.\n\nThe speaker has a rat king voice. The voice should sound raspy, nasal, sneaky, sharp, greedy, and commanding in a small-body way. The delivery should be quick and unpleasant, like a sewer ruler pretending to be grand.\n\nThe Rat King clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "talking_rat_gangster",
    index: 21,
    name: "Talking Rat Gangster",
    category: "Animals / Small Creatures",
    prompt: "A Talking Rat Gangster character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a clever street rat standing upright in a dirty alley, wearing a tiny torn coat, twitching whiskers, sharp yellow teeth, and nervous darting eyes.\n\nThe speaker has a talking rat gangster voice. The voice should sound small, sharp, scratchy, nasal, twitchy, sly, and mischievous. The delivery should be fast and tough-talking, like a cartoon criminal rat trying to sound bigger than he is.\n\nThe Talking Rat Gangster clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "tiny_mouse_hero",
    index: 22,
    name: "Tiny Mouse Hero",
    category: "Animals / Small Creatures",
    prompt: "A Tiny Mouse Hero character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a tiny brave mouse standing on a wooden table with a little cloak, bright eyes, soft fur, and a heroic stance far bigger than its body.\n\nThe speaker has a tiny mouse hero voice. The voice should sound very small, bright, brave, squeaky, earnest, and determined. The delivery should be clear and courageous, like a tiny character trying to sound heroic against impossible odds.\n\nThe Tiny Mouse Hero clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "trickster_imp",
    index: 23,
    name: "Trickster Imp",
    category: "Demonic / Infernal",
    prompt: "A Trickster Imp character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a tiny red imp crouched on a crooked shelf, with sharp little horns, a pointed tail, glowing yellow eyes, twitchy fingers, and a mischievous grin full of trouble.\n\nThe speaker has a trickster imp voice. The voice should sound small, fast, raspy, sneaky, playful, wicked, and energetic. The delivery should be quick and mischievous, like a tiny creature laughing while making a dangerous deal.\n\nThe Trickster Imp clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "insectoid_alien",
    index: 24,
    name: "Insectoid Alien",
    category: "Aliens / Cosmic / Elemental",
    prompt: "A Insectoid Alien character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a tall insectoid alien with armored chitin, antennae, many jointed limbs, black reflective eyes, mandibles, and quick precise movements inside a strange alien corridor.\n\nThe speaker has an insectoid alien voice. The voice should sound clicking, dry, sharp, quick, alien, chittering, and precise. The delivery should be intelligent but unsettling, as if human speech is being shaped by mandibles.\n\nThe Insectoid Alien clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "planet_eater_voice",
    index: 25,
    name: "Planet-Eater Voice",
    category: "Aliens / Cosmic / Elemental",
    prompt: "A Planet-Eater Voice character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a gigantic world-devouring being floating above a doomed planet, with a body larger than cities, burning eyes, a mouth like an eclipse, and gravity bending around its presence.\n\nThe speaker has a planet-eater voice. The voice should sound colossal, terrifying, slow, deep, hungry, godlike, and unstoppable. The delivery should feel like a cosmic monster announcing its presence before consuming a world.\n\nThe Planet-Eater Voice clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "void_whisperer",
    index: 26,
    name: "Void Whisperer",
    category: "Aliens / Cosmic / Elemental",
    prompt: "A Void Whisperer character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a faceless figure made of starless darkness, standing at the edge of an endless black void, with thin drifting robes and faint white light where eyes should be.\n\nThe speaker has a void whisperer voice. The voice should sound quiet, dark, close, airy, cold, eerie, and hypnotic. The delivery should be intimate and unsettling, like a whisper coming from the empty space behind the listener.\n\nThe Void Whisperer clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "fire_elemental",
    index: 27,
    name: "Fire Elemental",
    category: "Aliens / Cosmic / Elemental",
    prompt: "A Fire Elemental character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a living fire elemental shaped like a humanoid flame, with burning hair, molten eyes, bright orange skin, sparks rising from its shoulders, and constant heat rippling around it.\n\nThe speaker has a fire elemental voice. The voice should sound hot, sharp, crackling, energetic, fierce, bright, and intense. The delivery should be fast and alive, like words snapping out of flame.\n\nThe Fire Elemental clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "kraken",
    index: 28,
    name: "Kraken",
    category: "Aliens / Cosmic / Elemental",
    prompt: "A Kraken character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a colossal kraken rising from black ocean water, with enormous tentacles, ancient eyes, wet ridged skin, and the terrifying presence of a sea monster older than ships.\n\nThe speaker has a kraken voice. The voice should sound huge, wet, deep, ancient, monstrous, slow, and oceanic. The delivery should feel like a massive creature speaking from beneath crushing waves.\n\nThe Kraken clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "storm_giant",
    index: 29,
    name: "Storm Giant",
    category: "Giants / Ogres / Trolls",
    prompt: "A Storm Giant character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a massive storm giant standing on a cliff during a lightning storm, with blue-gray skin, white hair whipping in the wind, glowing eyes, and clouds circling his shoulders.\n\nThe speaker has a storm giant voice. The voice should sound enormous, booming, electric, commanding, wild, and thunderous. The delivery should feel like a giant shouting through storm clouds, with power behind every word.\n\nThe Storm Giant clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "thunder_beast",
    index: 30,
    name: "Thunder Beast",
    category: "Giants / Ogres / Trolls",
    prompt: "A Thunder Beast character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines a huge beast made of dark fur, horned armor, flashing blue lightning, and glowing eyes, stomping across a stormy battlefield with electricity cracking around its body.\n\nThe speaker has a thunder beast voice. The voice should sound animalistic, booming, rough, electric, angry, and powerful. The delivery should be fierce and explosive, like a monster growling through thunder.\n\nThe Thunder Beast clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
  {
    id: "tree_spirit",
    index: 31,
    name: "Tree Spirit",
    category: "Nature / Spirits",
    prompt: "A Tree Spirit character voice is auditioning an unnatural creature voice showcase.\n\nThe scene imagines an ancient tree spirit with bark skin, mossy hair, glowing green eyes, branch-like hands, and roots curling into the forest floor. The character feels old, gentle, patient, and connected to the earth.\n\nThe speaker has a tree spirit voice. The voice should sound ancient, gentle, woody, warm, slow, earthy, and wise. The delivery should be calm and grounded, like an old forest speaking through a living tree.\n\nThe Tree Spirit clearly says exactly:\n\"Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.\"\n",
    sampleLine: SAMPLE_LINE,
    enabled: true,
  },
] as const satisfies readonly UnnaturalVoicePreset[];

export function buildUnnaturalVoicePrompt(presetId: string): string {
  return UNNATURAL_VOICE_PRESETS.find((item) => item.id === presetId)?.prompt || UNNATURAL_VOICE_PRESETS[0].prompt;
}
