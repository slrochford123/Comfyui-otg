// Ported from Hailuo H3 Prompt Builder v2.8.0-beta.1
// (c) 2026 Bob Doyle Media, MIT.

export const H3_VISUAL_STYLE_PROFILES = {
  "Cinematic realism": "Naturalistic production design with physically accurate materials, motivated practical lighting, nuanced skin and surface texture, cinematic contrast, controlled depth of field and believable environmental interaction. Movement carries real weight and inertia; avoid synthetic gloss and generic stock-video polish.",
  "Live action": "Grounded live-action photography with authentic locations, practical light sources, natural exposure roll-off, convincing wardrobe and props, restrained color grading, human micro-expressions and realistic lens behavior. Preserve physical plausibility and documentary-level environmental detail.",
  "3D animation": "Premium feature-quality 3D animation with appealing sculpted forms, expressive facial rigs, detailed materials, soft global illumination, controlled subsurface scattering and confident animated posing. Motion uses readable anticipation, follow-through, squash and stretch without becoming weightless.",
  Cartoon: "Bold graphic cartoon design with clean silhouettes, expressive shape language, simplified but intentional backgrounds, punchy color separation and highly readable poses. Use elastic timing, visual exaggeration and crisp comedic reactions while keeping character construction consistent.",
  Anime: "Polished cinematic anime with precise linework, controlled cel shading, expressive eyes, dynamic perspective, atmospheric painted backgrounds, speed accents and dramatic color scripting. Use held poses punctuated by fluid bursts of action and carefully composed emotional close-ups.",
  Illustrated: "Living editorial illustration with visible authored linework, layered pigment or brush texture, selective detail, designed negative space and sophisticated color harmony. Motion should feel like the illustration has come alive while preserving its handmade surface and graphic composition.",
  "Game cinematic": "High-end real-time game cinematic with detailed characters and environments, volumetric atmosphere, dramatic rim lighting, physically based materials, heroic composition and responsive action animation. Camera and editing feel authored for a premium narrative cutscene.",
  "Gameplay / first-person": "Immersive first-person gameplay presentation with stable player geography, responsive head and weapon motion, readable environmental navigation, game-authentic lighting and tactile interaction. Camera acceleration, recoil and impacts remain controlled enough to preserve spatial clarity.",
  "Stop motion": "Handcrafted stop-motion production with tactile puppets, miniature sets, visible fabric, clay, wood or paper texture, practical miniature lighting, shallow macro depth of field and intentionally stepped frame-by-frame movement. Include tiny puppet-settle imperfections while avoiding smooth CGI motion.",
  "Mixed live action and hand-drawn animation": "Live-action photography integrated with expressive hand-drawn marks that wrap around surfaces, cast light, react to movement and inhabit the same perspective. Preserve natural footage texture while animated lines, paint and symbols retain visible human variation.",
  "Graphic motion design": "Precision motion design with bold typography, geometric systems, controlled grids, clean masking, deliberate transitions and rhythmically choreographed shape animation. Every movement reinforces hierarchy and composition; surfaces remain crisp and production-ready.",
  "Animated poster": "A striking poster composition that evolves through restrained parallax, animated lighting, atmospheric particles, moving type and one memorable visual transformation. Maintain a strong hero layout and finish on a clean, readable key art frame.",
  "Premium product commercial": "Luxury commercial photography with immaculate product geometry, controlled studio reflections, refined material rendering, macro detail, elegant camera motion and sculpted highlight falloff. Interactions showcase function and craftsmanship without inventing labels, features or claims.",
  "Visceral cinematic horror": "Tactile cinematic horror with oppressive darkness, sickly practical light, damp and decayed surfaces, uncomfortable proximity, deep negative space and brief fragments of disturbing detail. Withhold the threat before revealing it; use imperfect handheld movement, abrupt stillness and low-frequency physical sound rather than constant spectacle.",
  "Psychological thriller": "Controlled psychological-thriller imagery with compressed space, reflections, frames within frames, symmetrical compositions that gradually destabilize, muted color contaminated by one recurring accent and slow invasive camera movement. Emphasize uncertain perception, micro-expressions, off-screen implication and subjective sound.",
  "Gothic whimsy": "Playfully macabre storybook gothic design with crooked architecture, elongated silhouettes, spindly trees, theatrical miniature-like sets, moonlit fog and handcrafted surface imperfections. Use charcoal, bone-white and faded jewel tones, angular compositions and expressive movement that balances childlike wonder with elegant unease; avoid direct imitation of any named filmmaker.",
  "Dark fairy tale": "Lush but threatening folklore imagery with ancient forests, worn storybook textures, candlelit chiaroscuro, jewel-toned shadows, weathered costumes and beautiful objects carrying subtle danger. Frame the world with mythic scale, enchanted atmosphere and a constant tension between wonder and menace.",
  "Cosmic horror": "Overwhelming cosmic-horror scale with tiny human figures, impossible geometry, ancient nonhuman structures, distorted horizons, starless voids and light behaving in physically unsettling ways. Reveal incomprehensible forms only partially; emphasize awe, insignificance and deep subsonic resonance over conventional monsters.",
  "Supernatural mystery": "Atmospheric supernatural mystery with ordinary locations disturbed by one impossible detail, cool nocturnal color, pools of practical light, drifting haze, reflective surfaces and patient observational framing. Build evidence gradually through environmental changes, reactions and suggestive off-screen sound.",
  "Neo-noir crime": "Modern neo-noir crime photography with hard directional light, deep blacks, wet streets, sodium and neon color contrast, glass reflections, smoke and morally charged close-ups. Use long lenses, oblique framing and deliberate urban camera moves with restrained, dangerous energy.",
  "Analog found footage": "Degraded consumer-video authenticity with imperfect autofocus, sensor noise, clipped highlights, rolling exposure, timestamp-era color, nervous reframing and accidental obstructions. Events must feel captured rather than staged; preserve plausible operator behavior and unsettling off-camera audio without decorative digital glitch overload.",
  "Retro science fiction": "Tactile retro-futurism built from practical miniatures, painted control panels, CRT displays, analog switches, brushed metal, colored instrument light and optimistic mid-century industrial design. Combine clean graphic shapes with visible model-making detail and period-authentic optical effects.",
  "Dystopian future": "Severe dystopian worldbuilding with monumental surveillance architecture, dense infrastructure, polluted atmosphere, utilitarian clothing, harsh industrial lighting and controlled institutional color. Contrast overwhelming systems with vulnerable human-scale details and credible environmental wear.",
  "Disaster spectacle": "Large-scale disaster cinema with clearly established geography, escalating structural failure, credible mass and debris physics, atmospheric depth, human reaction inserts and wide shots that communicate enormous scale. Destruction unfolds as connected cause and effect rather than random visual noise.",
  "Action blockbuster": "Premium action-blockbuster imagery with strong chase geography, bold silhouettes, dynamic parallax, practical-feeling impacts, readable stunt motion, aggressive but motivated camera placement and escalating shot scale. Maintain screen direction and physical continuity through every cut.",
  "Pulp adventure": "Colorful pulp-adventure energy with exotic practical locations, weathered maps and machinery, heroic silhouettes, golden light, dangerous terrain and bold serialized storytelling. Camera movement feels athletic and optimistic; action favors ingenious escapes and tactile set pieces.",
  "Romantic fantasy": "Luminous romantic fantasy with ethereal natural light, flowing fabric, enchanted landscapes, delicate particles, elegant production design and intimate expressive close-ups. Use graceful camera movement and rich color transitions to make emotional connection feel physically present in the environment.",
  "Surreal dreamscape": "Poetic surrealism with lucid visual logic, seamless impossible transitions, symbolic objects, altered scale, gravity-defying but graceful motion and environments that transform through visual association. Maintain coherent lighting and composition so the dream feels intentional rather than randomly generated.",
} as const;

export const H3_VISUAL_STYLE_OPTIONS = Object.keys(H3_VISUAL_STYLE_PROFILES) as Array<keyof typeof H3_VISUAL_STYLE_PROFILES>;
export const H3_CAMERA_FEEL_OPTIONS = [
  "Automatic cinematic camera",
  "Static composition",
  "Gentle push-in",
  "Smooth tracking shot",
  "Handheld realism",
  "Orbit around the subject",
  "Crane reveal",
  "Fast FPV movement",
] as const;
export const H3_SHOT_FLOW_OPTIONS = [
  "Let H3 decide",
  "One continuous shot",
  "Multiple cinematic shots",
  "Dynamic action sequence",
  "Suspense / thriller buildup",
  "Horror escalation and reveal",
  "Fast commercial-style cuts",
  "Slow, deliberate pacing",
] as const;
export const PRODUCTION_V2_ASPECT_RATIO = "16:9" as const;
export const PRODUCTION_V2_QUALITY = "768P" as const;
export const H3_ASPECT_RATIO_OPTIONS = [PRODUCTION_V2_ASPECT_RATIO] as const;
export const H3_QUALITY_OPTIONS = [PRODUCTION_V2_QUALITY] as const;

export type ProductionV2VisualStyle = keyof typeof H3_VISUAL_STYLE_PROFILES;
export type ProductionV2CameraFeel = (typeof H3_CAMERA_FEEL_OPTIONS)[number];
export type ProductionV2ShotFlow = (typeof H3_SHOT_FLOW_OPTIONS)[number];
export type ProductionV2AspectRatio = (typeof H3_ASPECT_RATIO_OPTIONS)[number];
export type ProductionV2Quality = (typeof H3_QUALITY_OPTIONS)[number];

export type ProductionV2PromptOptions = {
  visualStyle: ProductionV2VisualStyle;
  cameraFeel: ProductionV2CameraFeel;
  shotFlow: ProductionV2ShotFlow;
  aspectRatio: ProductionV2AspectRatio;
  soundEnabled: boolean;
  quality: ProductionV2Quality;
  soundDirection: string;
  thingsToAvoid: string;
};

export const DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS: ProductionV2PromptOptions = {
  visualStyle: "Cinematic realism",
  cameraFeel: "Automatic cinematic camera",
  shotFlow: "Let H3 decide",
  aspectRatio: PRODUCTION_V2_ASPECT_RATIO,
  soundEnabled: true,
  quality: PRODUCTION_V2_QUALITY,
  soundDirection: "",
  thingsToAvoid: "",
};

export function h3StyleProfile(style: string) {
  return H3_VISUAL_STYLE_PROFILES[style as ProductionV2VisualStyle]
    || H3_VISUAL_STYLE_PROFILES[DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.visualStyle];
}

export function effectiveH3ShotFlow(flow: ProductionV2ShotFlow, style: string, idea: string): ProductionV2ShotFlow {
  if (flow !== "Let H3 decide") return flow;
  const context = `${style} ${idea}`;
  if (/horror|monster|creature|terrifying|nightmare|demon|ghost|haunt|slimy|roar|scary|macabre/i.test(context)) return "Horror escalation and reveal";
  if (/thriller|suspense|mystery|stalk|intruder|conspiracy|noir|unease|paranoi/i.test(context)) return "Suspense / thriller buildup";
  if (/Action blockbuster|Disaster spectacle|Pulp adventure/.test(style) || /\baction\b|chase|pursu|escape|battle|mech|explod|crash|disaster|fight|race/i.test(idea)) return "Dynamic action sequence";
  if (/commercial|product|advert|hero product|motion design|animated poster|quick cuts|social media|\bugc\b|tutorial|explaining|how to/i.test(context)) return "Fast commercial-style cuts";
  if (/meditat|contemplat|quiet|gentle|tender|slow|dreamscape|romantic/i.test(context)) return "Slow, deliberate pacing";
  return "Multiple cinematic shots";
}

export function productionV2TargetShotCount(duration: 5 | 10 | 15, flow: ProductionV2ShotFlow, style: string, idea: string) {
  const effective = effectiveH3ShotFlow(flow, style, idea);
  if (effective === "One continuous shot") return 1;
  if (effective === "Slow, deliberate pacing") return duration === 5 ? 1 : duration === 10 ? 2 : 3;
  if (["Dynamic action sequence", "Suspense / thriller buildup", "Horror escalation and reveal", "Fast commercial-style cuts"].includes(effective)) {
    return duration === 5 ? 2 : duration === 10 ? 4 : 5;
  }
  return duration === 5 ? 2 : duration === 10 ? 3 : 4;
}
