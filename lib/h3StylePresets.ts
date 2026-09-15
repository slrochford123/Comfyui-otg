export type H3StylePreset = {
  id: string;
  label: string;
  subtitle: string;
  category: string;
  description: string;
  masterPrompt: string;
  promptBuilderVisualStyle?: string;
  thumbnail?: string;
};

export const DEFAULT_H3_STYLE_PRESET_ID = "none";

export const H3_STYLE_PRESETS: H3StylePreset[] = [
  {
    id: DEFAULT_H3_STYLE_PRESET_ID,
    label: "Default / None",
    subtitle: "Use H3 normally",
    category: "Default",
    description:
      "No Atomic Gains master style prompt is added. Existing H3 prompt behavior remains unchanged.",
    masterPrompt: "",
  },
  {
    id: "old-animation-style",
    label: "Old Animation Style",
    subtitle: "LATE-1930s HAND-PAINTED THEATRICAL FEATURE",
    category: "Vintage & Broadcast Animation",
    description: "Pencil animation, hand-inked acetate cels and separately painted gouache backgrounds, held to a restrained early-Technicolor palette.",
    promptBuilderVisualStyle: "Cartoon",
    masterPrompt: `Render as an authentic late-1930s hand-painted American theatrical animated feature, created using traditional pencil animation, hand-inked acetate cels, opaque cel paint and separately painted gouache backgrounds.

Characters and moving foreground elements should have clean but subtly imperfect dark charcoal or brown-black ink outlines, with gentle variation in thickness and tiny natural irregularities. Designs should use simplified but believable anatomy, rounded organic forms, strong readable silhouettes, expressive eyes and faces, elegant hands and clear theatrical posing. Hair and clothing should be simplified into large graphic shapes suitable for traditional cel animation rather than realistic fine detail.

Use mostly flat opaque cel-painted colours with restrained two-tone or occasional three-tone shadow shapes. Keep surfaces matte and graphic. Avoid realistic gradients, glossy highlights, complex reflections or physically based lighting.

Backgrounds should look like lavish hand-painted gouache storybook paintings, with visible brush texture, softened distant detail, atmospheric perspective and layered foreground, midground and background depth. Background objects generally have softer edges and less heavy outlining than the animated characters.

Use a restrained early-Technicolor-inspired palette of aged ivory, cream, faded peach, dusty rose, brick red, ochre, warm brown, sage green, olive, muted turquoise, dusty blue, smoky purple and charcoal. Colours should feel like physical paint pigments rather than modern digital RGB colour.

Lighting should appear painted into the artwork using broad graphic light and shadow shapes.
Sunlight is warm cream or golden; night scenes use smoky blue, violet and grey rather than pure black. Keep silhouettes clear and theatrical.

Compose scenes like lavish illustrated storybook frames, with strong staging, elegant perspective and clear separation between foreground cels and painted backgrounds.

Add only subtle analogue characteristics: very fine film grain, slight celluloid warmth, soft optical resolution, tiny registration imperfections and minute colour-density variation. These should feel naturally photographed from physical artwork, not like a heavy vintage filter.

The final impression should be rich gouache environments + hand-inked cel characters + matte painted colour + warm vintage palette + classical handmade craftsmanship.

Avoid photorealism, 3D CGI, modern Pixar-style rendering, anime, vector art, glossy digital painting, modern cel-shaded 3D, HDR lighting, neon colours, heavy VHS effects, exaggerated sepia, modern concept-art rendering and extreme rubber-hose styling.

The result should look like a genuine colour animated feature produced and photographed from physical artwork in the late 1930s.`,
  },
  {
    id: "1980s-anime",
    label: "1980s Anime",
    subtitle: "MID-TO-LATE 1980s THEATRICAL & OVA CEL",
    category: "Vintage & Broadcast Animation",
    description: "Hand-inked cels over painted backgrounds, animated on twos with held drawings, smears and multiplane camera moves.",
    promptBuilderVisualStyle: "Anime",
    masterPrompt: `Create the entire video as an authentic mid-to-late 1980s Japanese hand-drawn anime sequence, resembling traditional theatrical anime and high-budget OVA cel animation.
Visual style
Traditional 2D hand-drawn animation photographed from physical painted cels.
Characters have bold but slightly imperfect hand-inked outlines, classic 1980s anime facial proportions, expressive eyes without modern glossy rendering, strong graphic silhouettes, angular facial construction, carefully shaped voluminous hair, flat hand-painted colors, and simple hard- edged cel shadows.
Avoid smooth digital shading. Shadows should appear as deliberately drawn solid shapes that move with the character.
Backgrounds are separate hand-painted animation backgrounds made with watercolor, gouache and poster-paint textures. They contain soft atmospheric perspective, visible brushwork, painterly skies, detailed architecture and environmental texture.
Characters should remain noticeably flatter and more graphic than the painted backgrounds, recreating the appearance of transparent animation cels placed over physical background paintings.
Animation movement
The movement must feel like traditional 1980s hand-drawn animation rather than modern interpolated animation.
Animate primarily on twos and occasionally on threes, producing approximately 8–12 unique character drawings per second while the finished film plays at normal cinematic speed.
Use intentionally held drawings between important poses.
Character motion should alternate between:
strong expressive key poses
brief held frames
rapid hand-drawn transitions
occasional exaggerated smear drawings during very fast movement slightly uneven spacing between animation drawings
small secondary movements in hair, clothing and accessories
subtle looping environmental animation
Do not create perfectly fluid AI-generated motion.
Movement should have the charming slight stutter and graphic timing of photographed cel animation.
Facial animation should be economical. Hold the face for several frames, then change expression decisively rather than continuously morphing every facial feature.
Blinking should happen through two or three clearly drawn poses.
Mouth animation should use a small number of traditional mouth shapes rather than hyper- accurate modern lip synchronization.
Hair movement should consist of several clearly drawn shapes transitioning between poses rather than individual simulated strands.
Clothing should move as simplified hand-drawn masses rather than realistic cloth simulation.
Camera language
Use cinematic 1980s anime filmmaking techniques.
Combine:
slow lateral pans across hand-painted backgrounds
dramatic push-ins toward mostly static character drawings
multiplane parallax between foreground, character and background layers sudden cuts to expressive close-ups
extreme low-angle hero shots
long-lens profile shots
environmental establishing shots
occasional rapid snap pans during action
dramatic still compositions held for emotional beats
Some shots can remain almost completely still while only hair, smoke, rain, eyes, clothing or background elements move.
During dramatic moments, allow the character pose to remain frozen while the camera slowly pushes toward them.
Action animation
Fast action should become more graphic rather than more physically simulated.
Use strong anticipation poses followed by explosive movement.
During extremely fast movement, use:
stretched limbs
hand-drawn smear frames
speed lines
briefly simplified character drawings
impact frames
sharp pose changes
animated debris and dust rendered as graphic cel shapes
Avoid modern motion interpolation.
Do not make every movement equally smooth.
Analog film appearance
The final sequence should look as though physical animation cels were photographed onto 35mm film.
Include:
subtle film grain, very faint film weave, slight frame-to-frame exposure variation, tiny cel- registration shifts, occasional dust particles, subtle color bleed, slightly softened ink edges, mild optical glow around bright highlights, slightly muted vintage color reproduction and gentle analog contrast.
These imperfections must remain subtle and believable.
Do not make the footage look deliberately damaged or covered in heavy VHS effects.
Lighting
Lighting should be illustrated rather than physically simulated.
Use large graphic shadow shapes, painted highlights, dramatic colored nighttime shadows, warm tungsten interiors, glowing sunsets, cool moonlight and neon reflections.
Bright objects may have a very slight optical glow caused by photographed film, but avoid modern digital bloom.
Overall result
The finished video should feel like a newly discovered sequence from a beautifully animated Japanese film produced around 1985–1989, created by human animators using pencils, ink, paint, physical animation cels and hand-painted backgrounds.
The animation should feel deliberately handcrafted, cinematic and slightly imperfect.
Avoid
modern digital anime, ultra-smooth 60fps animation, AI morphing between poses, motion interpolation, perfectly stable vector outlines, glossy digital gradients, modern compositing, 3D CGI character animation, realistic cloth simulation, realistic hair simulation, PBR lighting, modern game rendering, plastic surfaces, excessive bloom, excessive depth of field, hyper-detailed textures, modern moe character design, perfectly fluid facial animation.`,
  },
  {
    id: "1990s-fantasy-anime",
    label: "1990s Fantasy Anime",
    subtitle: "1990s FANTASY OVA",
    category: "Vintage & Broadcast Animation",
    description: "Elegant fantasy design staged over richly painted forests, ruined temples and moonlit plains, with hand-drawn luminous magic.",
    promptBuilderVisualStyle: "Anime",
    masterPrompt: `1990s FANTASY OVA ANIME

Render the scene as lush 1990s fantasy OVA anime with beautiful hand-painted backgrounds and elevated cinematic staging.

Characters should feature elegant fantasy anime design: expressive eyes, stylized noses, long hair flowing in large drawn masses, capes, armour, tunics, jewellery and layered cloth. Anatomy should be stylized but credible.

Backgrounds are vital: forests, ruined temples, mountains, castles, moonlit plains and magical skies should be richly painted, atmospheric and detailed. Use warm firelight, cool moonlight, hand-painted mist and magical glow.

Cel colour should be soft but rich. Use classic shadow shapes with subtle painted highlights.
Magic effects should be hand-drawn and luminous, with sparkles, rune circles, energy trails and light bursts.

Motion should feel romantic and dramatic: lingering beauty shots, cape movement, elegant sword swings, magical transformations, painterly wind and grand fantasy framing.

Avoid modern hyper-rendered fantasy game imagery.`,
  },
  {
    id: "1980s-sci-fi-anime",
    label: "1980s Sci-Fi Anime",
    subtitle: "1980s SCI-FI OVA",
    category: "Vintage & Broadcast Animation",
    description: "Rain-slick streets, neon reflections and loving mechanical detail, in painted cel colour with soft analogue compositing.",
    promptBuilderVisualStyle: "Anime",
    masterPrompt: `1980s SCI-FI OVA ANIME

Render the video as a richly detailed 1980s sci-fi OVA anime. The look should feel premium, cinematic and hand-crafted, with more detail than standard TV anime.

Characters should have mature 1980s anime features: sharper eyes, more refined facial proportions, elegant but slightly angular hair design, detailed jackets, flight suits or uniforms, and realistic-but-stylized body language.

Mechanical design is very important. Vehicles, control panels, weapons and machinery should be drawn with loving detail: vents, panels, bolts, gauges, pistons, tubing and layered industrial design. Backgrounds should be dense and atmospheric, featuring rain-slick streets, neon reflections, industrial skylines, spaceship interiors or giant hangars.

Use painted cel colours, restrained cel shading, carefully hand-painted highlights and soft analogue compositing. Add subtle film grain, occasional lens softness, painted glow in electronic lights and hand-drawn smoke, sparks, muzzle flashes or engine trails.

Animation should alternate between calm cinematic holds and expensive bursts of motion. Use detailed mechanical movement, dynamic perspective shots, expressive camera pans, dramatic close-ups and hand-drawn effects.

Avoid modern digital clean-up, flat vector simplification, or generic CGI mecha rendering.`,
  },
  {
    id: "creature-adventure-tv-anime",
    label: "Creature-Adventure TV Anime",
    subtitle: "LATE-1990s / EARLY-2000s BROADCAST",
    category: "Vintage & Broadcast Animation",
    description: "Young adventurers, original companion creatures and bright outdoor worlds in cheerful weekly-television cel anime.",
    promptBuilderVisualStyle: "Anime",
    masterPrompt: `Render [SUBJECT / SCENE] as a late-1990s / early-2000s hand-drawn Japanese creature- adventure television anime, with original young adventurers, expressive fantasy companion creatures, bright outdoor environments, energetic comedy and simple readable action.

Use authentic broadcast-era cel animation: clean dark charcoal/brown outlines, flat opaque colours, simple one-tone shadows, strong silhouettes, expressive faces and hand-painted backgrounds. Avoid modern glossy rendering.

Human characters should have slightly enlarged heads, large expressive eyes, tiny noses, flexible mouths, graphic spiky or rounded hair shapes, and colourful adventure clothing with simple colour blocking and minimal folds.

Companion creatures should be completely original, cute and highly readable, built from simple rounded forms, oversized heads, short limbs, large ears, tails, small horns or paws. Keep surface detail minimal and use bright colours with one or two contrasting accents. Animate them with lively ears, tails, body bounces, squash-and-stretch and exaggerated reactions.

Backgrounds should resemble painted television-anime scenery: blue skies, forests, grassy hills, roads, rivers, small towns, wooden buildings and rock formations. Backgrounds are softer and more painterly than the cel-painted characters, with reduced contrast in the distance.

Use a cheerful retro palette of sky blue, grass green, warm cream, sunny yellow, coral red, orange, teal, dusty blue and soft violet, slightly softened by analogue broadcast characteristics.

Animation should feel like quality weekly TV anime: held drawings interrupted by sudden energetic bursts, sharp reaction poses, head snaps, eye widening, mouth swaps, pointing gestures, run cycles and quick speed bursts. Fast action may use smear drawings, duplicated limbs, speed lines, impact frames and streaked backgrounds.
Comedy can briefly exaggerate characters through squash, stretch, shocked freezes or simplified super-deformed reactions before immediately returning to normal proportions.

Creature abilities should use simple hand-drawn cel effects such as electric arcs, wind spirals, water bursts, fireballs, leaves or energy rings, with flat graphic shapes rather than realistic VFX.

Use classic TV-anime cinematography: medium character shots, wide adventure setups, dramatic eye close-ups, low-angle hero shots, side-view running, rapid pans, crash zooms and reaction cutaways.

Add subtle analogue character: faint broadcast softness, fine grain, slight chroma softness, tiny cel- registration movement and gentle colour bleed.

Overall result: a completely original cheerful retro creature-adventure anime episode, colourful, expressive, charming and energetic.

Avoid: 3D CGI, photorealism, modern glossy anime rendering, realistic fur, ray tracing, game- engine visuals, branded symbols, copied characters, recognizable creatures, signature costumes or famous attacks.`,
  },
  {
    id: "sumi-e-ink",
    label: "Ink",
    subtitle: "SUMI-E INK-WASH ON RICE PAPER",
    category: "Painterly, Graphic & Material",
    description: "Bold black calligraphic brushwork and diluted grey washes bleeding into textured paper.",
    promptBuilderVisualStyle: "Illustrated",
    masterPrompt: `MASTER STYLE PROMPT — SUMI-E INK-WASH CINEMATIC ANIMATION

Render [SUBJECT / SCENE DESCRIPTION] as sophisticated East Asian ink-wash animation on textured rice paper, combining bold black calligraphic brushwork, diluted grey washes, restrained mineral pigments, negative space, and expressive hand-painted motion.

The image must feel physically painted with wet ink, never digitally illustrated.

Characters are formed from confident calligraphic silhouettes with elegant simplified anatomy.
Concentrate facial detail around the eyes, brows, mouth, and hands. Clothing should flow as broad expressive brush shapes rather than individually rendered folds.

Show natural brush behaviour: strokes begin dark and saturated, then gradually dry and break apart.
Include feathered edges, pooled ink, uneven absorption, dry-brush texture, and subtle rice-paper fibres.

Backgrounds use atmospheric ink washes. Distant mountains fade into pale grey, mist is created through untouched paper, rain appears as rapid brush marks, and clouds emerge from negative space surrounded by diluted ink.

Use restrained accents of oxidised red, muted indigo, pale jade, faded ochre, or mineral gold, while black ink and warm paper remain dominant.

MOTION LANGUAGE

Movement should exploit the ink medium. Sword swings become sweeping brush arcs; running figures stretch briefly into directional ink marks; impacts erupt into black splashes; smoke blooms through wet-in-wet pigment. During extreme motion, characters may partially dissolve into brush strokes before reforming.

Slow moments should remain elegant and controlled, with subtle hand-painted fluctuations.

CAMERA

Use cinematic composition translated into painted perspective. Wide shots should feel sparse and monumental. Telephoto shots compress mountains into layered ink silhouettes. Close-ups simplify the background and concentrate brush detail around the eyes and expression.

AVOID

No generic anime rendering, digital watercolor filters, CGI, glossy surfaces, or photorealistic textures.

The final result should feel like a master ink painter creating a cinematic film directly on rice paper.`,
  },
  {
    id: "hand-painted-silk",
    label: "Hand-Painted Silk",
    subtitle: "TRANSLUCENT PIGMENT ON WOVEN FABRIC",
    category: "Painterly, Graphic & Material",
    description: "Animation painted onto flowing hand-dyed silk, the weave and fibre bleed staying visible through every frame.",
    promptBuilderVisualStyle: "Illustrated",
    masterPrompt: `Render [SUBJECT / SCENE] as animation painted directly onto flowing hand-dyed silk, using translucent inks and pigments absorbed into fine woven fabric.

The silk surface must remain visible, with subtle weave, delicate fibres, soft pigment bleeding, and naturally feathered edges. Avoid hard digital contours.

Characters should feel elegant, elongated, and painterly, built from layered translucent pigment.
Clothing, hair, clouds, smoke, and environmental effects should flow naturally with the movement of the silk.

Use a restrained palette of deep indigo, faded crimson, antique gold, pale turquoise, smoky violet, and warm ivory.

MOTION

The silk itself influences the animation. Wind ripples the entire image, folds distort the painted environment, and characters stretch subtly as the fabric billows. Fast movement leaves translucent pigment trails, while clouds, magic, dust, and smoke diffuse naturally through the fibres.

LIGHTING

Softly backlight the silk so brighter regions glow through the fabric. No CGI volumetric lighting.

CAMERA

Use elegant cinematic framing. Macro shots reveal individual silk threads, while wide shots make the fabric feel like an immense painted world.

AVOID

No ordinary watercolor, CGI with fabric textures, hard digital edges, or rigid computer animation.`,
  },
  {
    id: "thick-paint",
    label: "Thick Paint",
    subtitle: "PAINT-ON-GLASS, FRAME BY FRAME",
    category: "Painterly, Graphic & Material",
    description: "Wet paint pushed across a glass plate — brush strokes, finger smears, palette-knife marks and ghosts of earlier frames.",
    promptBuilderVisualStyle: "Illustrated",
    masterPrompt: `Render everything as wet paint manipulated directly across a glass plate frame-by-frame.

Use visible brush strokes, finger smears, scraped paint, translucent wiped sections, palette-knife marks and remnants of earlier frames.

Characters remain readable but constantly shift at the edges.

Motion is created by physically repainting forms rather than sliding rigid objects.

Fast movement becomes:

dragged pigment

smeared figures

flowing colour trails

abstract paint shapes

scraped highlights

One environment can literally smear into the next.

Light is represented using pale paint or exposed glass.

Shadows are accumulated pigment.
No static painterly filter, CGI or perfectly stable digital forms.`,
  },
  {
    id: "oil-painting",
    label: "Oil Painting",
    subtitle: "PAINTERLY TEXTURED 3D",
    category: "Painterly, Graphic & Material",
    description: "Fully dimensional 3D with grounded body mechanics, every visible surface wearing thick painted texture.",
    promptBuilderVisualStyle: "3D animation",
    masterPrompt: `Painterly textured 3D animation, prestige-series hybrid cinematic look. Characters and environments are fully dimensional 3D with believable weight, grounded body mechanics and subtle dramatic acting, but absolutely every visible surface is treated as hand-painted illustration rather than photoreal CG. Skin consists of layered painted colour shapes with visible directional brushwork, simplified pores and sculptural highlights rather than photographic detail. Eyes contain small painted highlights and slightly exaggerated expressive shapes. Hair moves as broad painted clumps and graphic masses, never individual simulated strands. Clothing has illustrated weave, frayed edges and wear painted directly into the material.
Architecture, metal, dust, concrete and grime have obvious painterly texture with irregular brush marks and hand-authored imperfections.
Lighting is theatrical and strongly motivated, usually dominated by a single source. Shadows should contain visible painted colour transitions and textured brushwork rather than perfectly smooth digital gradients.
Smoke, dust, sparks, electricity and atmospheric FX are hand-drawn 2D painterly animation composited over the dimensional 3D scene, moving with deliberately stylized frame timing rather than realistic particle simulation.
Cinematography uses prestige live-action drama language: 50mm–135mm lenses, shallow depth of field, slow pushes, restrained handheld drift, rack focus, strong foreground layering and carefully composed close-ups.
Fine illustrated grain and subtle paper-like texture unify every frame.
Must not appear: photoreal pores, photographic skin, individually simulated hair strands, clean glossy CG surfaces, perfect ray-traced appearance, smooth particle simulations, flat cel shading, children's-cartoon proportions, excessively saturated cheerful lighting, weightless motion-capture animation.`,
  },
  {
    id: "charcoal",
    label: "Charcoal",
    subtitle: "WILLOW CHARCOAL ON RAG PAPER",
    category: "Painterly, Graphic & Material",
    description: "Velvet blacks and smudged greys with the light lifted out by eraser, staged in full film-noir lighting.",
    promptBuilderVisualStyle: "Illustrated",
    masterPrompt: `Charcoal animation drawn in willow charcoal on toothy rag paper, in full film-noir lighting.
[SCENE]. Forms are massed in velvet charcoal black and smudged greys, with all light lifted OUT of the drawing by eraser — window slats, hat-brim highlights, the rim of a glass — so illumination reads as removed charcoal, paper tooth showing inside every erased passage. Fingers-and- thumb smudge marks, redrawn ghost lines and charcoal dust speckle persist frame to frame; when a figure moves, the previous pose remains faintly beneath as an incompletely erased ghost.
A warm tobacco stain tints the paper unevenly. Smoke, rain and fog are the principal set decoration, drawn as soft dragged smudges that curl through the light slats. Compositions are hard noir: low angles, venetian-blind shadows raking across faces, single sources. Motion is deliberate and heavy, on twos, with drawings visibly reworked rather than replaced. Must not appear: colour, clean vector lines, cel-style flat fills, 3D, photorealism, evenly lit scenes, motion without ghost traces. Charcoal animation, willow charcoal on toothy paper in film-noir lighting: velvet blacks and smudged greys, all light lifted out by eraser with paper tooth showing, ghost poses persisting under movement, smoke and rain as dragged smudges, tobacco-stained paper, low angles and venetian-blind shadows, heavy deliberate motion on twos.`,
  },
  {
    id: "childrens-marker",
    label: "Doodle / Children's Marker",
    subtitle: "FELT-TIP MARKER ON PAPER",
    category: "Painterly, Graphic & Material",
    description: "Bleeding ink, uneven colouring and strokes that wander outside the outlines, over visible paper fibre.",
    promptBuilderVisualStyle: "Illustrated",
    masterPrompt: `CHILDREN'S MARKER-PEN ANIMATION

Render everything with felt-tip marker pens on ordinary paper.

Use:

bleeding ink

overlapping strokes

uneven colouring

colour outside outlines

visible paper fibres

Character designs are simple, but animation is extremely sophisticated.

Fast movement produces thick marker smears and exaggerated drawing deformation.

No vector illustration or clean tablet rendering.`,
  },
  {
    id: "theatrical-slapstick",
    label: "Tom & Jerry Style",
    subtitle: "1940s–1950s THEATRICAL SLAPSTICK",
    category: "Vintage & Broadcast Animation",
    description: "High-budget golden-age slapstick: elastic original animals, constructed smear drawings and orchestral comic timing.",
    promptBuilderVisualStyle: "Cartoon",
    masterPrompt: `MASTER STYLE PROMPT — 1940s–1950s THEATRICAL SLAPSTICK CEL ANIMATION Render the entire sequence as a lavish hand-drawn American theatrical cartoon from the 1940s–1950s, using traditional ink-and-paint cel animation over richly painted background artwork. The animation should feel like a high-budget theatrical short rather than television animation: extremely expressive poses, sophisticated comic timing, beautifully constructed smear drawings, exaggerated squash-and-stretch, strong silhouettes and carefully synchronized physical comedy.
CHARACTER DESIGN Create completely original animal characters. Design should use: expressive anthropomorphic animals, simplified but anatomically convincing bodies, large readable eyes, flexible eyebrows, broad cheeks, highly elastic mouths, oversized hands and feet where appropriate, clear contrasting silhouettes. Faces should be extraordinarily expressive.
Characters may temporarily deform far beyond their normal anatomy during fast action, shock or impacts, then immediately snap back to model. Avoid copying recognizable character shapes, colours, facial features or proportions from existing cartoon properties. LINEWORK Use clean hand-inked dark outlines with elegant line-weight variation. Outer contours are slightly thicker.
Internal facial and clothing lines are thinner. Lines should remain fluid and confident rather than digitally perfect. COLOUR Use rich vintage cel colours: warm cream, cherry red, mustard yellow, forest green, turquoise, warm brown, dusty blue, black, white. Characters use flat opaque cel paint with limited simple shading. Backgrounds are more painterly and softly rendered.
BACKGROUNDS Backgrounds resemble hand-painted theatrical cartoon layouts. Use: cozy kitchens, living rooms, gardens, city streets, workshops, barns, restaurants, hotel corridors.
Perspective may be slightly exaggerated for comedy. Furniture and props should be designed as part of the gag choreography. ANIMATION TIMING Animation should be highly rhythmic. Use: anticipation → hold → explosive action → overshoot → recovery → reaction. Include: long comic holds, two-frame eye reactions, sudden head snaps, fast take-off poses, extreme smears, multiple limb positions inside one drawing, dry-brush speed streaks, stretch frames, impact squashes, vibration holds. Fast motion must be represented with actual hand-drawn smear poses rather than digital blur. COMEDY Physical comedy should escalate logically. Props should become part of chained gags. Characters may: flatten, stretch, spin, accordion, telescope, squash into shapes, become temporarily rigid after impacts, display exaggerated takes. Keep violence cartoony, non-graphic and playful. CAMERA Use classic theatrical cartoon staging: side- on medium wides, strong composition, occasional fast pans, crash zoom-like push-ins, low-angle gag reveals, close-ups for reaction shots. Avoid modern cinematic handheld movement or 3D camera orbiting. MUSIC AND SOUND Animation should feel synchronized to orchestral cartoon scoring. Use: pizzicato strings, brass stabs, xylophone, woodblocks, cymbal crashes, rising string runs, comedic bassoon, percussion synced precisely to impacts. ANALOGUE CHARACTER Add subtle vintage softness and cel-registration variation, but keep the image clean and colourful. No heavy degradation. MUST NOT APPEAR No CGI. No modern vector animation. No photorealism.
No realistic animal fur. No modern glossy lighting. No digital motion blur. No existing famous cartoon characters. No recognizable costume, colour scheme or character silhouette copied from an existing cartoon. The final result should feel like an original lost theatrical slapstick cartoon from the golden age of American cel animation.`,
  },
  {
    id: "action-figure",
    label: "Action Figure",
    subtitle: "LATE-1990s LIVE-ACTION / CGI",
    category: "3D, Live Action & Hybrid",
    description: "Small articulated action figures come to life and physically exist inside a realistic human-sized world.",
    promptBuilderVisualStyle: "Live action",
    masterPrompt: `LATE-1990s LIVE-ACTION / CGI ACTION-FIGURE FANTASY Create a cinematic live-action scene in which small articulated action figures have mysteriously come to life and physically exist inside a completely realistic human-sized world. The environment must remain fully photorealistic and live-action: real rooms, real furniture, real wood, carpet, dust, fabric, household objects, natural imperfections and believable practical lighting. The living characters are approximately 15–25 cm tall manufactured action figures. They must always look like REAL PHYSICAL TOYS rather than miniature humans. ACTION FIGURE MATERIALS: Injection-molded hard plastic bodies, slightly glossy painted surfaces, tiny molded costume details, visible seams, screw holes, ball joints, hinge joints, rotating shoulders, mechanical elbows and knees, molded hair, painted eyes, tiny manufacturing imperfections, paint wear and subtle scratches. Their clothes are primarily sculpted plastic rather than real fabric unless deliberately designed otherwise. Never transform them into realistic miniature people. MOVEMENT: Animate the figures with extremely convincing CGI integrated into live-action photography, but preserve the mechanical limitations of physical toys.
Limbs pivot around visible joints. Shoulders rotate mechanically. Hands remain molded plastic.
Heads turn from the neck joint. Torso movement is slightly restricted. Their movement can be surprisingly agile and expressive, but every motion must still feel like a rigid articulated object being brought to life. Use convincing weight, momentum, acceleration, impacts, stumbling, climbing and landings. Tiny footsteps produce appropriately small physical reactions. Objects they touch react realistically. NO rubbery limbs. NO squash-and-stretch. NO cartoon physics. NO soft human skin. NO weightless CGI movement. SCALE: Constantly emphasize the enormous scale difference between the toys and the human environment. Table edges resemble cliffs.
Carpet fibres resemble thick vegetation. Kitchen utensils appear enormous. Chair legs resemble columns. Human footsteps cause subtle vibration. Ordinary household objects become massive environmental obstacles. CINEMATOGRAPHY: Shoot exactly like a professionally photographed live-action 1990s adventure/action movie. Frequently position the camera near action-figure eye level. Use macro and close-focus cinematography mixed with cinematic wides, low-angle tracking shots, dramatic push-ins, whip pans, rack focus, insert shots and practical handheld movement.
Use believable optical depth of field instead of exaggerated miniature tilt-shift. 24fps cinematic motion with natural photographic motion blur. LIGHTING: Naturalistic practical lighting interacting correctly with the plastic surfaces. Real reflections and highlights across glossy molded plastic.
Figures cast accurate small shadows onto the live-action environment. Match environmental bounce light, exposure, depth of field, lens distortion, grain and motion blur perfectly. VFX INTEGRATION: The toys should appear to have been physically present during filming. Whenever possible give the animation a subtle practical-puppet quality rather than polished modern CG perfection. Interactions with dust, water, crumbs, fabric, paper, smoke and debris must produce real physical reactions. TONE: Adventure, mischievous comedy, miniature-scale danger and slightly dark late-1990s family fantasy. The spectacle comes from treating tiny action figures with the seriousness and cinematography of full-sized action heroes. IMPORTANT: Do not make this look like a fully animated movie. Do not turn the environment into CGI. Do not make the characters cute vinyl toys. Do not use oversized cartoon eyes. Do not use smooth Pixar-like surfaces. Do not make the toys look like miniature humans. The final result should look like genuine live-action footage from a practical-effects-heavy 1990s movie into which physically believable articulated action figures have come alive.`,
  },
  {
    id: "puppet",
    label: "Puppet",
    subtitle: "MARIONETTE THEATRE, MINIATURE STAGE",
    category: "Stop-Motion & Practical",
    description: "Carved wooden marionettes with glossy painted faces and hinged jaws, filmed on a gilded proscenium.",
    promptBuilderVisualStyle: "Stop motion",
    masterPrompt: `Filmed marionette theatre on a miniature gilded proscenium stage.
[SCENE]. Every character is a carved wooden marionette with a
glossy painted face, fixed glass eyes, a hinged jaw that claps when it speaks, and articulated wooden limbs that swing with
real pendulum weight — always settling a beat after the body
stops. Fine control strings rise from wrists, knees and head to the darkness above the stage and catch the light; string
movement is honest and visible. Sets are theatrical machinery: painted canvas backdrops, flat scenery wings sliding in grooves.
Lighting is warm footlight cream from below and a
follow-spot from front-of-house, throwing tall soft shadows on the backdrop; the curtain crimson and gilt gold frame is
allowed in wide shots. Camera sits in the auditorium: wides,
gentle push-ins, and occasional close-ups where wood grain and chipped paint show. Must not appear: stringless movement,
flesh-like skin, facial expressions changing, 3D CG smoothness, real ocean or sky, camera positions impossible from a theatre
seat.

Filmed marionette theatre on a gilded proscenium stage: carved wooden puppets with glossy painted faces, hinged clapping jaws, pendulum-weight limbs settling a beat late, visible control
strings catching the light, painted canvas backdrops,
warm footlights and a follow-spot, camera
in the auditorium.`,
  },
  {
    id: "noir-cartoon",
    label: "Noir Cartoon",
    subtitle: "ANIMATED COMEDIC NOIR",
    category: "Vintage & Broadcast Animation",
    description: "Stylized 2D American adult animation with hard graphic shadows and a comic detective register.",
    promptBuilderVisualStyle: "Cartoon",
    masterPrompt: `MASTER STYLE PROMPT
STYLE IDENTITY — ANIMATED COMEDIC NOIR
Stylized 2D American adult animation mixing prime-time sitcom character design with graphic neo-noir cinematography.
Characters retain simplified television-cartoon anatomy but feature sharper silhouettes, angular faces, narrow eyes and exaggerated shadow shapes.
Heavy black ink outlines.
Restricted palette dominated by charcoal, desaturated blues, dirty beige, muted crimson and occasional saturated neon signs.
Hard-edged cel shadows cover large portions of characters.
Environments feature rainy streets, detective offices, diners, apartment buildings, alleys and smoky late-night city interiors.
Lighting remains dramatically cinematic despite simple animation.
Venetian-blind shadows, silhouettes, streetlight pools, wet pavement reflections and dramatic rim lighting.
Camera language references crime cinema: extreme low angles, Dutch tilts, long-lens surveillance framing, silhouette profiles, slow pushes and dramatic close-ups.
Characters behave with completely deadpan sitcom timing despite absurdly serious cinematography.`,
  },
  {
    id: "live-action-hybrid",
    label: "Live-Action Hybrid",
    subtitle: "PHOTOREAL PLATE + ANIMATED CHARACTER",
    category: "3D, Live Action & Hybrid",
    description: "A theatrical feature sequence combining photoreal live action with an animated performer and synchronised dialogue.",
    promptBuilderVisualStyle: "Mixed live action and hand-drawn animation",
    masterPrompt: `Format: cinematic live-action / animated-character hybrid
Dialogue: natural spoken English, synchronized accurately
MASTER VISUAL + ANIMATION STYLE
Create a premium theatrical feature-film sequence combining photoreal live-action cinematography with a highly stylized animated cartoon character visually inspired by mid-century American theatrical cel animation.
The environment, human performers, vehicles, dust, skies, props and practical effects must look completely live action and photographically real. Use realistic sunlight, natural exposure, cinematic dynamic range, physically believable shadows, atmospheric perspective, lens distortion, depth of field, motion blur and subtle film grain.
The animated character must intentionally remain clearly cartoon rather than photorealistic: clean graphic silhouette, simplified anatomy, oversized expressive eyes, exaggerated muzzle, large hands and feet, simple flat-color fur shapes, controlled graphic shading and very little realistic fur detail.
Although technically rendered cleanly enough for feature-film compositing, the character should behave as though animated by master traditional animators.
Animation language:
extremely strong key poses
readable silhouettes
exaggerated anticipation
squash and stretch
sudden changes of speed
long comedic holds
expressive eye darts
subtle takes before large reactions
smear-frame-inspired stretched poses during fast movement
impossible cartoon physics
delayed reactions
overshoot and settle
exaggerated facial deformation
elastic limbs during fast actions
perfectly staged pantomime
Motion should follow:
POSE → HOLD → ANTICIPATION → EXPLOSIVE ACTION → IMPACT → FROZEN REACTION → DELAYED CONSEQUENCE
Do not animate the cartoon character with constantly smooth realistic creature motion.
The character must feel physically present in the live-action world through: accurate contact shadows
realistic environmental lighting
reflected light
dust interaction
prop contact
correct eyelines
believable spatial positioning
objects responding to the character's weight and movement
However, preserve the intentional contrast between realistic photography and impossible cartoon behavior.
Camera language should resemble an expensive live-action comedy feature rather than an animated movie: real lenses, deliberate compositions, restrained camera movement and professional blocking.
Do not make the entire image cartoon-stylized.
Do not convert humans or environments into animation.
Do not create photorealistic animal fur.
Do not make the animated character resemble a plush mascot.
Do not make the animation generic modern family-film CGI.`,
  },
  {
    id: "smear-animation",
    label: "Smear Animation",
    subtitle: "CLASSIC SMEAR-FRAME TECHNIQUE",
    category: "Vintage & Broadcast Animation",
    description: "Wildly exaggerated in-betweens on every fast beat, snapping back to clean readable poses on the holds.",
    promptBuilderVisualStyle: "Cartoon",
    masterPrompt: `Create a stylized 2D animated sequence in a classic smear-animation style featuring [SUBJECT] performing [ACTION]. The animation should use intentional smear frames during all fast movements. Whenever the character accelerates, turns quickly, snaps, swings, punches, jumps, runs, or reacts suddenly, the in-between frames should distort dramatically with classic animation smears: elongated body parts, stretched faces, multiple eyes or hands in one frame, curved motion arcs, sweeping line-of-action distortions, and strong squash-and-stretch.
The key poses should remain clear and readable, while the transition frames become wildly exaggerated to sell speed and force. The distortion must feel deliberate and rhythmic, not like random morphing. Smears should appear only during fast action beats, and the character should return to solid, clean, readable form on held poses and slower movements. The result should feel like professional hand-drawn cartoon animation rather than realistic motion blur.
Use bold graphic shapes, expressive linework, elastic timing, snappy spacing, exaggerated anticipation, fast action, and clear follow-through. The motion should feel energetic, springy, playful, and highly animated. The animation may run on a stylized lower-frame feel if desired, but the movement must remain smooth and intentional through the use of smear frames. Keep the background simple and supportive so the motion reads clearly.
Visual style: 2D hand-drawn cartoon animation, classic smear-frame technique, dynamic gesture, strong pose-to-pose staging, expressive deformation, clean line art, stylized motion streaks, exaggerated cartoon physics, lively timing, and readable silhouettes.
Important: do not make the subject melt, morph randomly, or permanently change shape. The distortion should only happen momentarily during rapid movement, exactly like intentional smear frames in traditional animation.`,
  },
  {
    id: "cgi",
    label: "CGI",
    subtitle: "STYLIZED 3D THEATRICAL FEATURE",
    category: "3D, Live Action & Hybrid",
    description: "Appealing simplified designs with soft rounded forms and the polish of a modern animated feature.",
    promptBuilderVisualStyle: "3D animation",
    masterPrompt: `Render as a polished, cinematic stylized 3D animated film with the quality of a modern theatrical feature.

Use appealing simplified character designs with soft rounded forms, smooth silhouettes, and slightly exaggerated proportions. Faces should be highly expressive, with large glossy eyes, small simplified features, and subtle elastic deformation in the cheeks, brows, eyelids, and mouth.

Surfaces should feel soft, tactile, and slightly matte, with delicate texture in skin, fur, and fabric rather than hard plastic CGI. Lighting should be warm and cinematic, with soft golden highlights, gentle rim light, diffused shadows, and a subtle sense of atmospheric depth.

Animation should feel smooth, refined, and full of personality, using clear readable poses, natural facial acting, expressive blinking, small eye movements, head tilts, breathing, and soft secondary motion. Include subtle squash-and-stretch and occasional gentle exaggeration for emotion and charm, while keeping the movement believable and polished.

Use cinematic framing with expressive close-ups, shallow depth of field, soft background blur, and controlled camera movement. Backgrounds should be richly rendered but visually softer than the characters so the focus stays on performance.

Overall look: warm, adorable, emotionally expressive, premium stylized 3D animation — soft, rounded, tactile, cinematic, and highly polished.

Avoid: photorealism, stiff animation, hard-edged modeling, overly glossy plastic surfaces, video- game-style rendering, or exaggerated fast cartoon chaos.`,
  },
  {
    id: "cgi-live-action-hybrid",
    label: "CGI Live-Action Hybrid",
    subtitle: "PHOTOREAL CREATURE VFX",
    category: "3D, Live Action & Hybrid",
    description: "Real actors and real locations photographed on location, with fantastical creatures added in post.",
    promptBuilderVisualStyle: "Live action",
    masterPrompt: `Render as a premium live-action cinematic fantasy adventure with seamlessly integrated photoreal CGI creatures, as though real actors and real environments were photographed on location while fantastical creatures were added using high-end feature-film visual effects.

Keep all human characters completely photoreal and live-action, with realistic skin, hair, clothing, natural body movement and grounded performances. Environments should feel physically photographed: lush vegetation, wet rocks, forests, waterfalls, atmospheric mist, natural sunlight and realistic environmental detail.

CG creatures should feel physically present in the real world. Use highly detailed skin, scales, folds, subtle translucency, moisture, tiny surface imperfections and realistic specular highlights.
Designs can be slightly stylized and appealing, with expressive eyes, readable facial expressions and memorable silhouettes, while maintaining convincing anatomy, mass and texture.

Creature animation should combine realistic animal biomechanics with expressive character performance. Give bodies believable weight, inertia, muscle movement, breathing, soft-tissue motion and natural balance. Use subtle eye movements, blinking, head tilts and facial reactions to create personality without becoming cartoonish.

Integrate creatures perfectly into the live-action plate using accurate contact shadows, ambient light, reflections, water interaction, displaced foliage, footprints, splashes, drifting mist and environmental particles. Large creatures should convincingly affect their surroundings and communicate enormous physical scale.
Use cinematic natural lighting with soft daylight, warm sunlight, cool environmental bounce, backlit mist and realistic atmospheric depth. Maintain a filmic colour grade, natural contrast, slightly softened highlights and rich organic greens and earth tones.

Shoot with professional fantasy-adventure cinematography: sweeping establishing shots, low-angle scale shots, intimate creature close-ups, medium actor-and-creature two-shots, shallow depth of field, subtle handheld movement, slow push-ins and controlled tracking shots. Use foreground elements and environmental depth to make shots feel photographed rather than digitally staged.

Overall aesthetic: grounded live-action realism fused with charming, expressive, feature-film- quality CGI creatures — tactile, immersive, cinematic, adventurous and believable.

Avoid obvious video-game rendering, plastic CGI surfaces, cartoon animation, overly exaggerated expressions, weightless creature movement, artificial studio lighting, excessive digital sharpness or creatures that appear pasted into the environment.`,
  },
  {
    id: "claymation",
    label: "Claymation",
    subtitle: "HANDCRAFTED STOP-MOTION",
    category: "Stop-Motion & Practical",
    description: "Hand-sculpted modelling clay with chunky proportions and visible fingerprints, shot on miniature sets.",
    promptBuilderVisualStyle: "Stop motion",
    masterPrompt: `Render as premium handcrafted claymation stop-motion animation, photographed practically on miniature sets.

Characters should look physically sculpted by hand from soft modelling clay, with chunky rounded proportions, simplified anatomy, large expressive eyes, oversized hands, broad mouths and charmingly imperfect facial shapes. Preserve subtle handmade irregularities, tiny dents, fingerprints and slightly uneven sculpted surfaces rather than perfectly smooth CGI.

Combine the clay characters with real tactile materials: thick wool, yarn, fuzzy fibres, felt, fabric and coarse handmade hair. Fur and hairstyles should consist of visible individual strands, clumps and fibres that physically shift between frames.

Environments should resemble elaborate hand-built miniature sets using painted wood, plaster, clay, fabric and tiny practical props. Everything should feel physically constructed, slightly imperfect and richly textured.

Animate with authentic frame-by-frame stop-motion timing: approximately 12 unique poses per second photographed on twos, with tiny positional variations between frames, brief held poses, slightly stepped movement and strong readable key poses. Avoid perfectly fluid CGI interpolation.
Facial expressions should change through visibly sculpted pose changes while remaining charming and expressive.

Use warm practical miniature lighting, soft directional shadows, rich saturated colours and subtle cinematic depth of field. Macro and medium-close photography should reveal the physical textures of clay, wool, paint and miniature scenery.

Camera movement should feel carefully executed with a real stop-motion camera: mostly locked compositions, controlled pushes, small pans and deliberate cinematic framing.

Overall aesthetic: whimsical handcrafted clay puppet cinema — tactile, fuzzy, imperfect, colourful, dimensional and unmistakably physical, as though every character, hair strand, prop and set piece was built by hand and photographed one frame at a time.

Avoid smooth digital 3D surfaces, plastic CGI, perfect geometry, realistic human skin, digital motion blur, fluid 60fps movement or overly clean computer-generated environments.`,
  },
  {
    id: "wool",
    label: "Wool",
    subtitle: "NEEDLE-FELTED STOP-MOTION",
    category: "Stop-Motion & Practical",
    description: "Densely compressed wool fibres over simple internal armatures — fuzzy, uneven and unmistakably handmade.",
    promptBuilderVisualStyle: "Stop motion",
    masterPrompt: `Render [SUBJECT / SCENE] as handcrafted needle-felted wool stop-motion animation.

Characters are sculpted from densely compressed wool fibres over simple internal armatures.

MATERIAL

Visible fuzzy fibres.

Uneven handmade surfaces.

Small stray hairs.

Needle-punched texture.

Soft wool clothing.

Felted props.
CHARACTER DESIGN

Rounded, charming forms.

Small bead or felt eyes.

Simple stitched mouths.

Hair constructed from bundles of wool.

Clothing made from flat felt panels.

ENVIRONMENT

Everything is textile-based:

trees from twisted wool,

clouds from fluffy fibre,

rocks from dense grey felt,

water from layered blue wool,

fire from wispy orange fibres.

MOTION

Authentic stop-motion movement.

Tiny fibre changes between frames.

Arms and legs bend around internal wire armatures.

Fast action causes loose wool fibres to trail slightly.

LIGHTING

Warm miniature photography.

Soft shadows emphasize fuzzy surfaces.

MUST NOT APPEAR

No plastic toy look.

No smooth CGI fur.

No hyperreal individual hair simulation.`,
  },
  {
    id: "paper-cut-out",
    label: "Paper Cut-Out",
    subtitle: "LAYERED PAPER STOP-MOTION",
    category: "Stop-Motion & Practical",
    description: "Every character and set built from real textured paper and photographed as a physical miniature artwork.",
    promptBuilderVisualStyle: "Stop motion",
    masterPrompt: `Render as handcrafted paper cut-out stop-motion animation, created entirely from layered pieces of real textured paper and photographed as a physical miniature artwork.

Build every character, object and environment from individually cut, torn and layered paper shapes. Preserve rough deckled edges, visible paper fibres, wrinkles, creases, uneven cuts, tiny imperfections and subtle variations in thickness. Nothing should appear digitally perfect or vector- clean.
Create strong physical depth through multiple stacked paper layers: foreground foliage, characters, terrain, mountains, clouds and distant scenery should sit on separate planes, producing small natural shadows between layers and gentle parallax as the camera moves.

Use a warm handmade colour palette of faded ochre, burnt orange, rust red, deep navy, dusty teal, cream, tan and muted brown. Colours should resemble painted, dyed or printed craft paper, with slight mottling and natural tonal variation rather than smooth digital gradients.

Characters should be simplified into readable graphic silhouettes assembled from small articulated paper pieces. Movement should feel like traditional cut-out stop motion: slightly stepped frame- by-frame posing, tiny positional changes, brief holds, deliberate limb rotations and subtle handmade jitter. Avoid perfectly fluid CGI motion.

Environmental animation should also feel physically manipulated by hand: paper leaves shift, clouds slide across layers, loose objects rotate or flutter, and scenery moves through small incremental changes.

Use mostly fixed or gently controlled camera movement with slow pushes, pans and layered parallax. Lighting should resemble soft practical studio illumination falling across a real paper diorama, creating delicate contact shadows and emphasizing the thickness and texture of each layer.

Overall aesthetic: whimsical handcrafted storybook collage brought to life through stop motion — tactile, layered, imperfect, graphic, warm and visibly made from real paper.

Avoid smooth vector graphics, flat digital illustrations, glossy CGI, perfect geometric edges, realistic 3D materials, heavy motion blur or overly fluid animation.`,
  },
  {
    id: "medieval-parchment",
    label: "Medieval Parchment",
    subtitle: "LIVING ILLUMINATED MANUSCRIPT",
    category: "Painterly, Graphic & Material",
    description: "Aged parchment with visible fibres, uneven staining and painted manuscript figures that move.",
    promptBuilderVisualStyle: "Illustrated",
    masterPrompt: `Render [SUBJECT / SCENE] as a living medieval illuminated manuscript painted on aged parchment.

SURFACE

Warm parchment.

Visible fibres.

Uneven age staining.

Tiny cracks.

Subtle page curvature.

ART STYLE

Characters resemble painted manuscript miniatures.

Flattened perspective.

Elegant side-facing poses.

Simplified anatomy.

Decorative costumes.

Gold-leaf halos, borders and motifs.

Architecture appears symbolic rather than spatially realistic.

Castles may appear unusually small beside characters.
Mountains resemble stacked decorative rock shapes.

Trees resemble ornamental botanical symbols.

COLOUR

Use historical-looking pigments:

ultramarine blue,

vermilion,

red ochre,

malachite green,

burnished gold,

aged ivory,

brown ink,

muted violet.

Gold areas catch light as physical metallic leaf.

ANIMATION

Figures move while remaining faithful to manuscript construction.

Characters can walk sideways with charming stiff-legged movement.

Animals have unusual medieval proportions.

Fire becomes repeating decorative red-and-gold flame shapes.

Water becomes parallel painted blue curves.

Clouds become ornamental spirals.

Magic becomes gold-leaf stars, suns, vines or geometric symbols.

Objects can break the rules of physical space intentionally.

FRAME

Decorative illuminated borders may react to events.

Vines creep around the page.

Small animals hiding in margins can observe the story.

MUST NOT APPEAR

No realistic perspective.

No 3D modelling.

No photorealistic medieval world.
No modern fantasy concept-art rendering.

Everything remains painted onto parchment.`,
  },
  {
    id: "embroidery",
    label: "Embroidery",
    subtitle: "LIVING TAPESTRY",
    category: "Painterly, Graphic & Material",
    description: "Coloured cotton and wool thread stitched into heavy woven fabric, raised and catching the light.",
    promptBuilderVisualStyle: "Stop motion",
    masterPrompt: `EMBROIDERY / LIVING TAPESTRY

MASTER STYLE PROMPT

Render [SUBJECT / SCENE] as a living embroidered tapestry stitched into heavy woven fabric.

MATERIAL

Visible woven textile base.

Coloured cotton and wool thread.

Raised embroidery.

Fabric patches.

Loose fibres.

Tiny knots.

Uneven handmade stitches.

CHARACTER DESIGN

Character outlines are embroidered using thick dark thread.

Faces use small stitched shapes.

Hair consists of bundled thread or yarn.

Clothing uses differently textured fabric patches sewn onto the base.
ENVIRONMENT

Grass = dense green stitches.

Water = repeating horizontal blue threads.

Clouds = fuzzy white wool.

Mountains = layered fabric patches.

Fire = loose red, orange and yellow yarn.

MOTION

Animation occurs by stitches physically rearranging themselves.

Walking feet cause thread to pull tight and relax.

Running characters leave temporarily loose trailing fibres.

Objects may unravel during transformations and restitch themselves elsewhere.

CAMERA

Camera can move across the tapestry like a macro lens examining textile art.

Shallow physical depth reveals raised stitching.

MUST NOT APPEAR

No printed fabric texture pasted over CGI.

No smooth digital characters.

Everything must visibly be constructed from thread and cloth.`,
  },
  {
    id: "paper-stop-motion",
    label: "Paper Stop-Motion",
    subtitle: "PAPIER-MÂCHÉ FANTASY",
    category: "Stop-Motion & Practical",
    description: "Newspaper pulp, cardboard armatures and torn-paper strips under hand-painted matte surfaces.",
    promptBuilderVisualStyle: "Stop motion",
    masterPrompt: `Everything is created as handcrafted papier-mâché stop-motion fantasy using newspaper pulp, cardboard armatures, layered tissue, glued torn-paper strips and hand-painted matte surfaces.

Surfaces must display physical construction: paper overlaps, warped cardboard, wrinkled tissue, dried glue deposits, paint streaks, torn edges and subtle newspaper fragments beneath the colour.

Characters have exaggerated handmade proportions, uneven noses, slightly mismatched eyes, irregular fingers and visible sculptural asymmetry. Robes are layered coloured tissue over wire- supported bodies.

Movement should resemble sophisticated traditional replacement and armature stop-motion with slightly stepped timing and tiny tactile imperfections.

Magic is completely physical. Spells use spiralling paper ribbons, replacement-animation stars, confetti sparks, translucent tissue circles and handmade paper lightning. Smoke is shredded tissue.
Fire is layered red and orange cut-paper elements.

No digital glowing particles, smooth CGI magic, clay surfaces or realistic fabric.`,
  },
  {
    id: "marbled-paper",
    label: "Marbled Paper",
    subtitle: "HANDMADE MARBLED PIGMENT",
    category: "Painterly, Graphic & Material",
    description: "Readable characters whose interiors are flowing veins of colour, moving continuously rather than mapped on.",
    promptBuilderVisualStyle: "Illustrated",
    masterPrompt: `Render everything from handmade marbled paper.

Characters remain readable while their interiors contain flowing veins of colour.

Patterns must move continuously rather than remaining mapped textures.

Transformations happen as pigments swirl, separate and reorganise.

Use elegant marble combinations such as:

turquoise / cream / gold

burgundy / navy / ivory

sage / ochre / brown

No static texture mapping or CGI.`,
  },
  {
    id: "painted-cgi",
    label: "Painted CGI",
    subtitle: "PRESTIGE PAINTERLY 3D",
    category: "3D, Live Action & Hybrid",
    description: "Grounded 3D performance under hand-painted texture — brushstrokes in skin tones, painted highlights.",
    promptBuilderVisualStyle: "3D animation",
    masterPrompt: `Painterly textured 3D animation, prestige-series hybrid look.
[SCENE]. Characters are fully 3D with grounded cinematic
performance, but every surface wears hand-painted texture —
visible brushstrokes in skin tones, painted highlights in the
eyes, cloth with illustrated weave and wear, city walls with
grime painted rather than photographed. Lighting is theatrical and moody: single strong motivated sources, painted-looking
light pooling, faces sculpted by shadow with brushwork visible in the falloff. Effects are deliberately 2D: smoke, sparks,
magic and explosions are hand-drawn painterly elements
composited over the 3D, moving on their own timing. Hair moves in painted clumps, not strands. Cameras are live-action
sensibilities — long lenses, slow pushes, rack focus — with
fine painterly grain over everything. Must not appear:
photoreal skin or pore detail, plastic clean CG surfaces,
smooth particle simulations for FX, flat toon shading,
saturated cheerful lighting, motion-capture float.

Painterly textured 3D, prestige-series hybrid: 3D characters
with hand-painted skin, cloth and grime, visible brushwork in
light falloff, theatrical single-source lighting, hand-drawn
2D smoke and spark FX over the render, long lenses and slow
pushes, fine painterly grain.`,
  },
  {
    id: "vintage-poster",
    label: "Vintage Poster",
    subtitle: "MID-CENTURY SCREEN PRINT",
    category: "Painterly, Graphic & Material",
    description: "Four to six physical-looking ink colours on heavy paper, with slightly uneven registration.",
    promptBuilderVisualStyle: "Graphic motion design",
    masterPrompt: `VINTAGE SCREEN-PRINTED POSTER ANIMATION

MASTER STYLE PROMPT

Render [SUBJECT / SCENE] as a moving mid-century screen-printed poster.

Use only 4–6 physical-looking ink colours.

PRINT CHARACTER

Heavy paper texture.

Slightly uneven ink.

Tiny missing pigment spots.

Overprinted colours.

Visible halftone patterns.

Minor colour-registration errors.

Edges occasionally bleed into paper fibres.
DESIGN

Reduce characters and scenery to:

large geometric shapes,

bold silhouettes,

strong negative space,

limited shading.

Shadows may consist of one solid secondary ink.

Faces are simplified into a few carefully placed graphic elements.

MOTION

When objects move quickly, individual colour layers may lag behind by one or two frames.

Impacts create graphic burst shapes.

Dust becomes halftone clouds.

Speed lines become bold printed wedges.

Transitions can occur through huge blocks of ink wiping across the frame.

CAMERA

Favor striking graphic compositions.
Extreme diagonals.

Huge foreground silhouettes.

Minimal depth.

MUST NOT APPEAR

No gradients.

No CGI materials.

No realistic shadows.

No photographic texture.

No detailed 3D environments.`,
  },
  {
    id: "1970s-tokusatsu",
    label: "1970s Tokusatsu",
    subtitle: "PRACTICAL SUITMATION ON 16mm",
    category: "Stop-Motion & Practical",
    description: "Performers in hand-built rubber-and-fibreglass monster suits wrecking a practical miniature city.",
    promptBuilderVisualStyle: "Live action",
    masterPrompt: `Render as an authentic 1970s Japanese giant-monster television sequence filmed practically on 16mm.

All giant characters are performers in cumbersome hand-built rubber-and-fiberglass costumes.

The environment is a practical miniature set with models.

Water should look like real water filmed in miniature scale, with slightly oversized splashes that reveal the model photography.

Suit construction remains visible:
rubber wrinkles, thick boots, foam musculature, fiberglass chest plates, painted seams and simple mechanical jaw movement.

Use real pyrotechnic spark charges, miniature explosions, smoke pots, compressed-air debris and breakaway models.

Energy effects use hand-painted cel streaks and analogue optical glow.
Camera style should feature extreme low angles, hard cuts, sudden crash zooms, telephoto compression, whip-pans and overcranked destruction footage.

Use faded 1970s colour, grain, gate weave, dust, cyan shadows, halated highlights and soft 16mm focus.

No CGI, digital water, modern compositing, photoreal scale simulation or agile suit movement.`,
  },
  {
    id: "1930s-animation",
    label: "1930s Animation",
    subtitle: "BLACK-AND-WHITE RUBBER HOSE",
    category: "Vintage & Broadcast Animation",
    description: "Pie-cut pupils, four-fingered gloves and boneless noodle limbs, printed to worn nitrate film.",
    promptBuilderVisualStyle: "Cartoon",
    masterPrompt: `Early-1930s black-and-white rubber-hose cartoon, hand-inked and photographed to worn nitrate film. [SCENE]. Characters have round heads, pie-cut pupils, four-fingered white gloves and boneless noodle limbs that bend in smooth curves with no elbows or knees; bodies squash and stretch extravagantly. Every character, prop and background element — houses, trees, moons, furniture — bounces, sways or taps in time with the musical beat; the whole world is alive and rhythmic. Rendered only in inkwell black, three silvery greys and nitrate white, with painted grey-wash backgrounds softer than the crisp inked characters. Constant film artifacts: dancing scratches, dust, gate flicker, a soft vignette, and slight
contrast pumping. Animation is full and bouncy on ones and twos with looping cycles proudly visible. Must not appear: colour of any kind, modern clean lines, 3D, photorealism, off-beat motion, anatomically correct joints, smooth digital stabilisation.

Early-1930s black-and-white rubber-hose cartoon on worn nitrate film: noodle-limbed characters with pie-cut eyes and white gloves, everything in the world bouncing on the musical beat, inkwell
black with silvery greys and nitrate white, grey-wash painted
backgrounds, dancing scratches and gate flicker throughout.`,
  },
  {
    id: "american-sitcom-animation",
    label: "American Sitcom Animation",
    subtitle: "SUBURBAN PRIME-TIME CARTOON",
    category: "Vintage & Broadcast Animation",
    description: "Rounded shapes, bold dark contours and large heads in traditional 2D television sitcom animation.",
    promptBuilderVisualStyle: "Cartoon",
    masterPrompt: `STYLE IDENTITY — AMERICAN SUBURBAN PRIME-TIME CARTOON
Traditional-looking 2D American television sitcom animation.
Characters constructed from highly simplified rounded shapes with bold dark contour lines, large heads, compact torsos, simple hands, minimal anatomical detail and instantly readable silhouettes.
Facial design uses dot or oval eyes, simple curved noses and highly flexible mouths capable of dramatic lip-sync shapes.
Flat bright color fills with almost no texture. Minimal cel shadows only when necessary.
Suburban environments use clean perspective and colorful background painting: kitchens, living rooms, driveways, supermarkets, offices and neighborhood streets.
Animation deliberately prioritizes acting and comedy over constant movement. Characters often hold poses while talking, then suddenly perform a very exaggerated gesture or reaction.
Dialogue scenes use professionally staged television coverage: wide establishing shot, medium two-shot, over-the-shoulder singles, reaction close-ups and occasional dramatic push-ins.
Comedy timing includes uncomfortable pauses, delayed reactions, sudden visual punchlines and absurd escalation.
Avoid realistic anatomy, painterly detail, 3D lighting, photorealistic textures or anime aesthetics.`,
  },
  {
    id: "stylized-2d-editorial",
    label: "Stylized 2D Editorial",
    subtitle: "RETRO MID-CENTURY GRAPHIC",
    category: "Painterly, Graphic & Material",
    description: "Bold simplified shapes, flat colour fills, clean silhouettes and minimal hand-drawn outlines.",
    promptBuilderVisualStyle: "Graphic motion design",
    masterPrompt: `Render as stylized 2D editorial animation with a retro mid-century graphic-design aesthetic.

Use bold, simplified shapes, flat colour fills, clean silhouettes and minimal hand-drawn black outlines. Characters should have elongated limbs, small heads, simplified facial features, oversized clothing and playful slightly awkward proportions, giving them an expressive illustrated quality rather than realistic anatomy.

Use a tightly controlled vintage-inspired palette dominated by deep cobalt blue, mustard yellow, burnt orange, forest green, warm cream and black. Keep shading extremely minimal or completely flat, with only occasional subtle texture or printed-paper grain.

Objects and environments should be reduced into large geometric graphic forms, often exaggerated dramatically in scale. Treat everyday objects as visual architecture, allowing characters to climb, run across or interact with oversized illustrated objects.

Animation should feel snappy, playful and design-driven, using strong key poses, quick directional changes, short holds, simplified walk/run cycles and occasional stretched transitional poses. Maintain a slightly limited-animation feel rather than ultra-fluid movement.

Use creative graphic transitions where shapes, objects and backgrounds naturally become the next scene. Employ rapid zoom-outs, push-ins, lateral tracking, match cuts, scale changes and continuous visual reveals while keeping compositions clean and highly readable.

Maintain a mostly flat frontal or slightly dimensional perspective, with minimal realistic depth.
Layer elements for subtle parallax, but preserve the appearance of a moving editorial illustration rather than a 3D world.

Add very subtle analogue imperfections such as faint paper texture, tiny line inconsistencies and restrained print-like grain.

Overall aesthetic: bold retro editorial illustration brought to life — playful, graphic, intelligent, colourful, minimalist and highly art-directed, resembling animated magazine artwork or vintage advertising graphics.

Avoid photorealism, 3D CGI, realistic lighting, detailed textures, complex gradients, heavy shadows, glossy materials, anime rendering or overly smooth digital motion.`,
  },
  {
    id: "rgb-phosphor-crt-arcade",
    label: "RGB Phosphor CRT Arcade",
    subtitle: "1990s ARCADE DISPLAY",
    category: "Painterly, Graphic & Material",
    description: "The whole image built from a dense matrix of individually glowing phosphor dots, never a smooth render.",
    promptBuilderVisualStyle: "Graphic motion design",
    masterPrompt: `Rendered entirely in a 1990s RGB phosphor CRT arcade display style: the entire image is built from a dense matrix of individually glowing circular dots (phosphor/pixel dots), never a smooth or vector illustration. Each dot glows in saturated red, green, or blue, with visible gaps of pure black between dots — a true dot-matrix/halftone texture, not a gradient. Every edge and contour carries a sharp RGB chromatic aberration fringe, where the red, green, and blue channels are slightly offset from each other, creating a glowing rainbow-edge halo along silhouettes, exactly like color misconvergence on an old CRT monitor. The background is pure, flat solid black — no scenery, no gradient, no vignette, nothing except the glowing subject. Lighting is entirely self-illuminated by the dot glow itself — no external light source, no shadows cast onto a surface, no ambient occlusion beyond the dot density thinning out toward the edges of forms.
Color palette stays within the RGB primary/phosphor range (reds, greens, blues, cyans from overlap) — no browns, no pastels, no naturalistic skin tones. The overall impression is a retro arcade demo screen, laser-etched dot-matrix poster, or an old CRT scoreboard display brought to life — sharp, glowing, slightly artificial, high contrast against the black void.`,
  }
];

export function resolveH3StylePreset(
  value: unknown,
): H3StylePreset | null {
  const id = String(value ?? "").trim();
  if (!id || id === DEFAULT_H3_STYLE_PRESET_ID) return null;
  return H3_STYLE_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function resolveH3PromptBuilderVisualStyle(
  value: unknown,
  fallback: string,
) {
  return resolveH3StylePreset(value)?.promptBuilderVisualStyle || fallback;
}

function prepareMasterPromptForVideoContent(masterPrompt: string) {
  const reference = "the video content described below";

  return masterPrompt
    .replace(
      /\[SUBJECT\s*\/\s*SCENE\s+DESCRIPTION\]/gi,
      reference,
    )
    .replace(/\[SUBJECT\s*\/\s*SCENE\]/gi, reference)
    .replace(
      /featuring\s+\[SUBJECT\]\s+performing\s+\[ACTION\]/gi,
      `featuring ${reference}`,
    )
    .replace(/\[SCENE\]/gi, reference)
    .replace(/\[SUBJECT\]/gi, reference)
    .replace(/\[ACTION\]/gi, reference);
}

export function composeH3StylePrompt(
  userPrompt: string,
  preset: H3StylePreset | null,
) {
  const content = String(userPrompt ?? "").trim();

  if (!preset || !preset.masterPrompt.trim()) {
    return content;
  }

  return [
    "VISUAL STYLE — APPLY CONSISTENTLY THROUGHOUT THE ENTIRE VIDEO:",
    prepareMasterPromptForVideoContent(preset.masterPrompt.trim()),
    "",
    "VIDEO CONTENT:",
    content,
  ].join("\n");
}
