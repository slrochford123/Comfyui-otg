// OTG_CHARACTER_3D_ANIMATION_STYLES_PHASE11
// User-facing labels may reference familiar 3D-animation studios or film families.
// Model-facing prompts intentionally describe visual traits rather than asking for creator imitation.

export const THREE_D_ANIMATION_STYLE_PRESETS = [
  {
    id: "default",
    label: "Default",
    description: "Use the regular 3D Animation art-style preset without adding a studio/family sub-style.",
    prompt: "",
  },
  {
    id: "pixar-classic-toy",
    label: "Pixar - Classic Toy Feature",
    description: "Rounded feature-animation characters with clean toy-like materials and highly readable expressions.",
    prompt:
      "stylized family feature-animation 3D character, rounded appealing geometry, clean toy-like plastic and fabric materials, simplified but expressive facial construction, large readable eyes, soft controlled surface detail, bright cinematic key lighting, polished global illumination, strong uncluttered silhouette, animation-friendly proportions",
  },
  {
    id: "pixar-superhero-graphic",
    label: "Pixar - Superhero Graphic 3D",
    description: "Graphic mid-century superhero proportions with strong silhouettes and simplified sculpted surfaces.",
    prompt:
      "graphic stylized 3D superhero character, strong mid-century shape language, elongated or compact exaggerated proportions, angular facial planes, simplified sculpted hair masses, clean costume geometry, restrained material texture, bold silhouette, dramatic feature-film lighting, polished animation-ready rendering",
  },
  {
    id: "pixar-soft-sculpted",
    label: "Pixar - Soft Sculpted Family",
    description: "Soft, rounded, youthful character design with low surface noise and warm friendly rendering.",
    prompt:
      "soft sculpted family-animation 3D character, rounded cheeks and facial planes, simplified nose and mouth forms, large warm expressive eyes, grouped hair shapes, smooth matte-to-satin materials, restrained micro-detail, gentle color transitions, warm diffuse cinematic lighting, friendly readable silhouette, highly animation-ready construction",
  },
  {
    id: "pixar-folk-fantasy",
    label: "Pixar - Colorful Folk Fantasy",
    description: "Richly colored folk-fantasy feature design with handcrafted decorative motifs and warm glow.",
    prompt:
      "colorful folk-fantasy 3D animation character, stylized sculpted anatomy, decorative handcrafted costume motifs, saturated jewel-like palette, warm emissive accents, simplified material response, selective ornamental detail, clean facial readability, soft cinematic bounce light, celebratory feature-film finish without photorealistic micro-texture",
  },
  {
    id: "disney-fairytale-princess",
    label: "Disney - Fairytale Princess 3D",
    description: "Elegant fairytale character design with large expressive eyes, flowing hair masses, and soft cinematic polish.",
    prompt:
      "elegant fairytale feature-animation 3D character, graceful appealing facial proportions, large expressive eyes, smooth stylized skin, carefully grouped flowing hair masses, refined costume shapes, soft fabric materials, luminous cinematic lighting, polished romantic color palette, clean readable silhouette, restrained realistic texture",
  },
  {
    id: "disney-tropical-adventure",
    label: "Disney - Tropical Adventure 3D",
    description: "Warm adventure styling with broad expressive faces, natural hair shapes, and handcrafted tropical materials.",
    prompt:
      "warm tropical adventure 3D animation character, strong readable anatomy, broad expressive facial construction, natural grouped curls or hair masses, handcrafted woven and organic materials, sun-warmed skin tones, saturated ocean-and-island palette, soft cinematic sunlight, appealing feature-animation proportions, controlled surface detail",
  },
  {
    id: "disney-magical-family",
    label: "Disney - Magical Family 3D",
    description: "Warm rounded family-film characters with colorful textiles, expressive faces, and gentle magical accents.",
    prompt:
      "magical family feature-animation 3D character, warm rounded facial construction, expressive brows and eyes, appealing stylized anatomy, colorful textile and embroidery shapes, rich but controlled color palette, soft skin and hair materials, subtle magical glow accents, polished cinematic lighting, clear friendly silhouette",
  },
  {
    id: "disney-anthropomorphic-city",
    label: "Disney - Anthropomorphic City 3D",
    description: "Polished anthropomorphic animal characters with readable fur, clothing, and human-like expression.",
    prompt:
      "polished anthropomorphic animal 3D animation character, species-aware stylized anatomy, expressive human-readable face, clean groomed fur masses, tailored simplified clothing, natural but saturated color palette, bright feature-film lighting, clear material separation, strong silhouette, realistic-enough fur without excessive strand detail",
  },
  {
    id: "dreamworks-fairytale-comedy",
    label: "DreamWorks - Fairytale Comedy 3D",
    description: "Caricatured fairytale-comedy characters with broad anatomy, earthy materials, and elastic expressions.",
    prompt:
      "comedic fairytale 3D animation character, caricatured facial proportions, broad readable anatomy, expressive eyebrows and mouth shapes, slightly chunky hands and features, earthy stylized materials, simplified costume surfaces, warm theatrical lighting, humorous silhouette, polished feature-animation rendering with restrained realism",
  },
  {
    id: "dreamworks-martial-arts",
    label: "DreamWorks - Painterly Martial Arts",
    description: "Bold martial-arts character design combining graphic shapes, painterly accents, and strong pose readability.",
    prompt:
      "painterly martial-arts 3D animation character, bold graphic shape language, exaggerated but coherent anatomy, strong gesture-ready silhouette, simplified fur or fabric masses, traditional decorative motifs, controlled painterly color accents, crisp directional lighting, selective texture, energetic cinematic presentation without micro-detail clutter",
  },
  {
    id: "dreamworks-creature-adventure",
    label: "DreamWorks - Epic Creature Adventure",
    description: "Semi-real fantasy creature design with appealing anatomy, atmospheric lighting, and tactile but controlled materials.",
    prompt:
      "epic creature-adventure 3D animation character, appealing semi-real anatomy, strong recognizable silhouette, stylized scales fur or leather materials, expressive eyes and face, controlled tactile texture, atmospheric sky and rim lighting, cinematic fantasy color grading, adventurous feature-film finish, realism balanced with animation readability",
  },
  {
    id: "dreamworks-graphic-storybook",
    label: "DreamWorks - Graphic Storybook 3D",
    description: "Graphic storybook CGI with simplified geometry, drawn-looking contours, and flatter stylized shading.",
    prompt:
      "graphic storybook 3D animation character, simplified angular geometry, drawn-looking contour accents, bold shape-based shadows, flatter material response, selective brush-like texture, strong pose and silhouette, rich graphic color separation, slightly stepped illustrative lighting, 2D design sensibility translated into dimensional CGI",
  },
  {
    id: "illumination-rounded-comedy",
    label: "Illumination - Rounded Comedy 3D",
    description: "Highly simplified rounded comedy characters with bright colors and compact readable proportions.",
    prompt:
      "bright comedy feature-animation 3D character, highly simplified rounded body forms, compact limbs, oversized readable facial expression, large clean eyes, glossy-to-satin simplified materials, vivid primary color accents, minimal surface detail, soft studio lighting, extremely clear silhouette and animation-friendly construction",
  },
  {
    id: "illumination-musical-animal",
    label: "Illumination - Musical Animal 3D",
    description: "Friendly anthropomorphic performers with clean fur, polished costumes, and colorful stage presentation.",
    prompt:
      "friendly musical anthropomorphic 3D animation character, rounded appealing animal anatomy, clean groomed fur masses, expressive eyes and mouth, polished simplified costume, colorful stage-light accents, smooth feature-film materials, strong performance-ready silhouette, cheerful cinematic presentation with controlled texture detail",
  },
  {
    id: "illumination-game-world",
    label: "Illumination - Game-World Feature 3D",
    description: "Chunky colorful game-world characters with polished materials, exaggerated proportions, and bold silhouettes.",
    prompt:
      "colorful game-world feature-animation 3D character, chunky exaggerated proportions, bold clean silhouette, polished toy-like fabric metal and leather materials, saturated colors, simplified facial geometry, large expressive eyes, crisp rim lighting, highly readable costume shapes, premium cinematic CGI without photorealistic surface noise",
  },
  {
    id: "sony-comic-hybrid",
    label: "Sony - Comic-Book Hybrid 3D",
    description: "Dimensional characters treated with comic linework, halftones, graphic shadows, and strong color separation.",
    prompt:
      "comic-book hybrid 3D character, dimensional sculpted form combined with inked contour accents, halftone and print-like texture, graphic stepped shadows, bold color separation, selective line hatching, exaggerated perspective-ready silhouette, intentionally illustrative lighting, energetic stylized CGI that visibly blends 2D comic language with 3D form",
  },
  {
    id: "sony-sketchbook-hybrid",
    label: "Sony - Sketchbook Hybrid 3D",
    description: "Energetic CGI with doodles, sketch marks, hand-drawn overlays, and intentionally imperfect graphic texture.",
    prompt:
      "sketchbook hybrid 3D animation character, clean dimensional base forms with hand-drawn doodle overlays, loose pencil and marker accents, intentionally imperfect graphic marks, flattened shadow shapes, youthful saturated palette, simple materials, expressive pose, energetic handmade visual language layered over polished CGI",
  },
  {
    id: "sony-elastic-cartoon",
    label: "Sony - Elastic Cartoon 3D",
    description: "Extreme squash-and-stretch CGI with thin limbs, large expressions, and highly caricatured posing.",
    prompt:
      "elastic cartoon 3D animation character, extreme squash-and-stretch proportions, thin flexible limbs, oversized facial expressions, strongly caricatured pose language, simplified smooth materials, bold clean colors, minimal fine texture, clear silhouette, energetic comedic feature-animation rendering designed for exaggerated movement",
  },
  {
    id: "blue-sky-animal-adventure",
    label: "Blue Sky - Expressive Animal Adventure",
    description: "Colorful family-adventure animals with soft fur masses, elastic faces, and broad comedic expressions.",
    prompt:
      "expressive family-adventure 3D animal character, soft simplified fur masses, broad elastic facial construction, rounded appealing anatomy, colorful environmental palette, clean readable eyes, controlled strand detail, bright naturalistic feature-film lighting, playful silhouette, polished but approachable CGI rendering",
  },
  {
    id: "fortiche-painted-cinematic",
    label: "Fortiche - Painted Cinematic 3D",
    description: "Sculpted dimensional characters with painterly surfaces, visible brush texture, and dramatic graphic lighting.",
    prompt:
      "painted cinematic 3D character, sculpted dimensional anatomy with visible hand-painted surface treatment, brush-like texture and broken color, strong facial planes, graphic shadow grouping, sophisticated muted-to-saturated color grading, dramatic rim and key lighting, selective detail, premium illustrative CGI rather than glossy realism",
  },
  {
    id: "reel-fx-carved-folk",
    label: "Reel FX - Carved Folk-Art 3D",
    description: "Carved puppet-like character construction with decorative geometry, wood texture, and theatrical color.",
    prompt:
      "carved folk-art 3D animation character, wooden puppet-like construction, visible carved planes and joints, decorative geometric costume motifs, tactile handcrafted surface, saturated festival colors, simplified facial features, theatrical warm lighting, miniature-stage feeling, strongly stylized silhouette with intentional handmade imperfection",
  },
  {
    id: "animal-logic-brick-plastic",
    label: "Animal Logic - Brick / Plastic 3D",
    description: "Physical toy-brick character design with hard plastic materials, seams, joints, and miniature-scale lighting.",
    prompt:
      "physical brick-toy 3D character, modular hard-surface construction, visible seams studs and articulated joints, injection-molded plastic material, crisp reflections, tiny manufacturing imperfections, miniature-world scale, clean product-like lighting, strong geometric silhouette, convincing practical toy photography translated into animation CGI",
  },
  {
    id: "skydance-storybook-fantasy",
    label: "Skydance - Modern Storybook Fantasy",
    description: "Contemporary fantasy-feature characters with soft appealing geometry, elegant costumes, and luminous environments.",
    prompt:
      "modern storybook fantasy 3D animation character, soft appealing facial geometry, elegant stylized anatomy, flowing simplified costume shapes, polished satin and fabric materials, luminous magical environment lighting, rich contemporary color palette, clean expressive eyes, premium family-feature finish, restrained micro-detail",
  },
  {
    id: "laika-gothic-stop-motion",
    label: "LAIKA - Handcrafted Gothic Stop-Motion",
    description: "Physical puppet and miniature-set aesthetic with fabric, paper, wood, and deliberate handcrafted imperfection.",
    prompt:
      "handcrafted gothic stop-motion character, physical puppet proportions, subtly visible joints and fabricated forms, tactile fabric paper wood and painted surfaces, intentional handmade imperfections, miniature-set scale, moody theatrical lighting, expressive sculpted face, shallow practical-camera feel, richly atmospheric but clearly non-photoreal CGI simulation",
  },
  {
    id: "aardman-clay-animation",
    label: "Aardman - Clay Animation 3D",
    description: "Molded clay character design with matte tactile surfaces, simple anatomy, and expressive handmade faces.",
    prompt:
      "clay-animation 3D character, molded plasticine-like forms, rounded simplified anatomy, matte tactile surface with subtle thumb and sculpting imperfections, compact expressive eyes and mouth, handmade costume props, miniature-set lighting, warm practical shadows, charming stop-motion silhouette, deliberately physical handcrafted appearance",
  },
] as const;

export type ThreeDAnimationStyleId =
  (typeof THREE_D_ANIMATION_STYLE_PRESETS)[number]["id"];

const THREE_D_ANIMATION_STYLE_IDS = new Set<string>(
  THREE_D_ANIMATION_STYLE_PRESETS.map((preset) => preset.id),
);

export function isThreeDAnimationStyleId(
  value: unknown,
): value is ThreeDAnimationStyleId {
  return THREE_D_ANIMATION_STYLE_IDS.has(String(value || ""));
}

export function threeDAnimationStylePrompt(
  id: ThreeDAnimationStyleId,
): string {
  return (
    THREE_D_ANIMATION_STYLE_PRESETS.find((preset) => preset.id === id)?.prompt ??
    ""
  );
}
