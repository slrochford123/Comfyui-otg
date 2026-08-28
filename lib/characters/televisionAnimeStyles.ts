// OTG_CHARACTER_TELEVISION_ANIME_STYLES_PHASE9
// User-facing labels may reference familiar television-anime families.
// Model-facing prompts intentionally describe visual traits rather than creator imitation.

export const TELEVISION_ANIME_STYLE_PRESETS = [
  {
    id: "default",
    label: "Default",
    description: "Use the regular Anime art-style preset without adding a television-anime sub-style.",
    prompt: "",
  },
  {
    id: "retro-90s-cel",
    label: "Retro Anime (90s Cel)",
    description: "Broad old-school hand-drawn television anime with economical linework and cel shading.",
    prompt:
      "classic late-1980s to 1990s television anime aesthetic, hand-drawn cel animation look, bold confident ink outlines, simplified facial construction, large graphic hair masses, flat two-to-three-tone cel shading, limited gradients, saturated but slightly vintage colors, restrained texture, minimal micro-detail, strong readable silhouettes, animation-friendly shapes",
  },
  {
    id: "dragon-ball-action",
    label: "Dragon Ball-era Action",
    description: "Classic high-energy shonen action with graphic hair, athletic anatomy, and hard cel shadows.",
    prompt:
      "classic high-energy shonen television anime aesthetic, bold clean contours, athletic stylized anatomy, angular expressive eyes, large sharply grouped hair silhouettes, simple readable martial-arts clothing, flat hard-edged cel shadows, saturated colors, minimal texture, strong action-ready proportions, uncluttered animation-friendly design",
  },
  {
    id: "naruto-ninja",
    label: "Naruto-era Ninja Action",
    description: "Early-2000s ninja shonen styling with clean silhouettes and restrained cel detail.",
    prompt:
      "early-2000s ninja shonen television anime aesthetic, clean angular faces, expressive eyes, spiky grouped hair shapes, readable layered ninja clothing, moderate line detail, simple cel shading, earthy saturated palette, strong silhouette, restrained texture and highlights, animation-friendly character construction",
  },
  {
    id: "demon-slayer-painted",
    label: "Demon Slayer-era Painted Action",
    description: "Modern sword-action anime with crisp character drawing and selective traditional painted accents.",
    prompt:
      "modern sword-action television anime aesthetic, clean character linework, large graphic eyes, controlled cel shading, elegant traditional Japanese pattern language, rich but disciplined color accents, selective painterly atmosphere, crisp silhouette, refined surfaces without hyper-detailed micro-texture",
  },
  {
    id: "solo-leveling-dark",
    label: "Solo Leveling-style Dark Action",
    description: "Sleek contemporary dark-action anime with lean proportions and luminous accents.",
    prompt:
      "sleek contemporary dark action anime aesthetic, tall lean proportions, sharp jawlines and eyes, clean dark clothing silhouettes, controlled line detail, high-contrast cel shading, cool muted palette with luminous accent colors, polished dramatic presentation without excessive texture",
  },
  {
    id: "yugioh-duelist",
    label: "Yu-Gi-Oh!-style Duelist Anime",
    description: "Graphic early-2000s duelist design with extreme hair silhouettes and angular costume geometry.",
    prompt:
      "early-2000s duelist television anime aesthetic, extremely graphic multi-directional hair silhouettes, narrow angular faces, sharp expressive eyes, geometric costumes and accessories, bold clean outlines, flat cel shadows, vivid accent colors, theatrical but readable design, minimal micro-detail",
  },
  {
    id: "death-note-gothic",
    label: "Death Note-style Psychological Gothic",
    description: "Mature psychological anime with realistic proportions, dark clothing, and restrained rendering.",
    prompt:
      "mature psychological television anime aesthetic, realistic anime proportions, narrow expressive eyes, restrained facial exaggeration, natural grouped hair shapes, contemporary dark clothing, fine but controlled linework, subdued neutral palette, crisp shadows, selective high contrast, minimal gloss and texture",
  },
  {
    id: "one-piece-expressive",
    label: "One Piece-style Expressive Adventure",
    description: "Exaggerated adventure shonen with highly readable silhouettes and elastic expression.",
    prompt:
      "expressive adventure shonen anime aesthetic, elastic facial expressions, highly readable simplified anatomy, exaggerated but coherent body shapes, bold contour lines, large graphic costume shapes, bright saturated colors, simple cel shadows, playful silhouettes, low micro-detail for animation",
  },
  {
    id: "bleach-fashion",
    label: "Bleach-style Fashion Action",
    description: "Lean supernatural-action design with strong black shapes and fashion-forward silhouettes.",
    prompt:
      "stylish supernatural action anime aesthetic, long lean proportions, angular mature faces, fashionable graphic clothing, large areas of black and white, economical linework, restrained cel shading, sharp silhouette design, cool confident presentation, minimal surface clutter",
  },
  {
    id: "hunter-classic",
    label: "Hunter x Hunter-style Classic Adventure",
    description: "Clean classic adventure shonen with youthful faces and straightforward cel treatment.",
    prompt:
      "classic adventure shonen television anime aesthetic, youthful expressive faces, compact clean linework, simple grouped hair shapes, clear readable costumes, bright controlled colors, straightforward cel shading, balanced proportions, low texture, animation-friendly construction",
  },
  {
    id: "yuyu-supernatural",
    label: "Yu Yu Hakusho-style 90s Supernatural",
    description: "1990s supernatural shonen with stronger outlines and a vintage cel palette.",
    prompt:
      "1990s supernatural shonen cel-animation aesthetic, confident black outlines, angular faces, compact expressive eyes, sharply grouped hair, classic streetwear and uniforms, flat two-tone cel shadows, slightly muted vintage palette, strong silhouette, minimal surface detail",
  },
  {
    id: "jojo-fashion",
    label: "JoJo-style Fashion Manga",
    description: "Sculptural action-anime design with editorial posing and unconventional graphic color.",
    prompt:
      "high-fashion dramatic action anime aesthetic, sculptural anatomy, pronounced facial planes, bold ink contouring, theatrical posing, graphic costume construction, stylized shadow shapes, unconventional accent colors, strong contrast, editorial silhouette design",
  },
  {
    id: "mha-superhero",
    label: "My Hero Academia-style Superhero Shonen",
    description: "Bright modern superhero shonen with comic-influenced linework and readable costumes.",
    prompt:
      "modern superhero shonen anime aesthetic, clean comic-influenced outlines, large expressive eyes, strong readable silhouettes, simplified hero costume geometry, vivid colors, crisp cel shading, energetic proportions, controlled texture, polished television-animation finish",
  },
  {
    id: "jjk-occult",
    label: "Jujutsu Kaisen-style Modern Occult",
    description: "Contemporary occult-action anime with natural proportions and restrained dark styling.",
    prompt:
      "modern occult action anime aesthetic, natural contemporary proportions, sharp expressive eyes, slightly rough confident line character, dark simple uniforms and streetwear, muted colors, selective strong shadows, restrained highlights, minimal decorative clutter, cinematic intensity",
  },
  {
    id: "chainsaw-cinematic",
    label: "Chainsaw Man-style Cinematic Rough",
    description: "Film-oriented contemporary anime with natural proportions and subdued visual treatment.",
    prompt:
      "cinematic contemporary anime aesthetic, more natural body proportions, understated facial exaggeration, casual modern clothing, economical linework, subdued palette, realistic light direction translated into cel shading, sparse texture, filmic composition, gritty but clean character rendering",
  },
  {
    id: "one-punch-clean",
    label: "One-Punch Man-style Clean Power Fantasy",
    description: "Crisp modern action anime with strong anatomy, simple costumes, and low surface clutter.",
    prompt:
      "clean modern power-action anime aesthetic, crisp line art, strong simplified anatomy, broad readable costume shapes, minimal accessories, precise cel shading, saturated but controlled colors, dynamic silhouette, very low micro-detail, polished animation-ready finish",
  },
  {
    id: "inuyasha-fantasy",
    label: "Inuyasha-style 90s Fantasy Romance",
    description: "Warm 1990s fantasy-romance cel animation with classic faces and flowing hair masses.",
    prompt:
      "1990s fantasy-romance television anime aesthetic, classic oval facial construction, clear expressive eyes, flowing grouped hair, simple traditional clothing masses, warm cel-animation palette, clean outlines, flat shadows, gentle vintage finish, restrained detail",
  },
  {
    id: "ranma-comedy",
    label: "Ranma 1/2-style Late-80s Comedy",
    description: "Rounded late-1980s comedy anime with simple anatomy and bright flat cel color.",
    prompt:
      "late-1980s to early-1990s comedy anime aesthetic, rounded expressive faces, simple anatomy, lively gesture, clean black outlines, bright flat colors, very simple cel shadows, grouped hair shapes, minimal detail, playful animation-friendly design",
  },
  {
    id: "fotns-muscular",
    label: "Fist of the North Star-style 80s Muscular Action",
    description: "Heavy 1980s action-anime anatomy with rugged silhouettes and dramatic cel shadows.",
    prompt:
      "1980s muscular action anime aesthetic, heavily built anatomy, stern mature facial construction, thick confident outlines, deep graphic shadow shapes, rugged clothing, muted desert colors, sparse gritty cel-animation texture, powerful silhouette",
  },
  {
    id: "sailor-magical",
    label: "Sailor Moon-style Magical Girl Cel",
    description: "Elegant 1990s magical-girl cel animation with long limbs and clean pastel shapes.",
    prompt:
      "1990s magical-girl cel-animation aesthetic, long elegant limbs, delicate facial construction, large luminous expressive eyes, flowing grouped hair shapes, clean costume geometry, bright pastel accents, flat cel shading, crisp outlines, graceful silhouette, minimal texture",
  },
  {
    id: "aot-military",
    label: "Attack on Titan-style Military Dark Fantasy",
    description: "Grounded military dark-fantasy anime with realistic proportions and heavier shadows.",
    prompt:
      "military dark-fantasy anime aesthetic, more realistic facial proportions, practical uniform construction, earthy desaturated palette, firm dark linework, heavier cel shadows, restrained eye exaggeration, grounded anatomy, dramatic serious presentation, controlled texture",
  },
  {
    id: "akira-cyberpunk",
    label: "Akira-style 80s Cyberpunk",
    description: "Late-1980s hand-drawn cyberpunk with grounded faces and analog painted-cel character rendering.",
    prompt:
      "late-1980s hand-drawn cyberpunk anime aesthetic, grounded realistic facial construction, period urban clothing, confident traditional ink lines, dense but controlled mechanical detail, muted city palette, hard cel shadows, analog painted-cel finish, cinematic realism without photorealism",
  },
  {
    id: "ghost-shell-tech",
    label: "Ghost in the Shell-style Sci-Fi Mature",
    description: "Mature cybernetic science-fiction anime with precise anatomy and controlled technical detail.",
    prompt:
      "mature cybernetic science-fiction anime aesthetic, realistic adult anatomy, precise facial construction, technical clothing and cybernetic elements, clean controlled linework, cool restrained palette, crisp cel shading, selective machinery detail, sophisticated minimal presentation",
  },
  {
    id: "trigun-space-western",
    label: "Trigun-style 90s Space Western",
    description: "Lanky 1990s space-western cel design with dramatic coats and dusty warm color.",
    prompt:
      "1990s space-western cel anime aesthetic, lanky expressive proportions, angular faces, dramatic coat silhouettes, simplified western and science-fiction costume shapes, strong black outlines, flat cel shadows, dusty warm palette, restrained texture, highly readable design",
  },
  {
    id: "eva-mecha-character",
    label: "Evangelion-style 90s Mecha Character",
    description: "Minimal 1990s mecha-era character styling with slender proportions and subdued cel color.",
    prompt:
      "1990s psychological mecha television anime character aesthetic, slender proportions, small angular faces, restrained expressive eyes, clean grouped hair shapes, simple uniforms and casual clothing, economical linework, flat cel shading, subdued colors, minimalist graphic presentation",
  },
] as const;

export type TelevisionAnimeStyleId =
  (typeof TELEVISION_ANIME_STYLE_PRESETS)[number]["id"];

export function isTelevisionAnimeStyleId(
  value: unknown,
): value is TelevisionAnimeStyleId {
  const normalized = String(value || "");
  return TELEVISION_ANIME_STYLE_PRESETS.some(
    (preset) => preset.id === normalized,
  );
}

export function televisionAnimeStylePrompt(
  id: TelevisionAnimeStyleId,
): string {
  return (
    TELEVISION_ANIME_STYLE_PRESETS.find((preset) => preset.id === id)?.prompt ||
    ""
  );
}
