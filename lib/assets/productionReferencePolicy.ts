/** Opt-in Production asset policies. Ordinary Story Creator/shot prompts are unchanged. */
export const ASSET_PROMPT_VERSION = 2;
const body = "Full-body reference: head fully visible, both arms and hands visible, legs and feet visible; entire figure inside the frame with generous margin above the head and below the feet. Centered, neutral readable standing pose; no cropped limbs or close-up.";
const isolated = "Plain neutral studio/reference background with even readable lighting. No surrounding environment, furniture, vehicles, other characters or story action.";
export const productionReferencePolicies: Record<string, readonly string[]> = {
  "production-environment-empty": ["Reusable empty environment reference, location only. Wide or medium-wide view with readable architecture, interior/exterior layout, lighting and set dressing.", "Unoccupied location: no people, human figures, staff, crowds or scene action. Characters are created separately."],
  "production-environment-extras": ["Reusable environment reference. Wide or medium-wide location coverage; architecture and set dressing remain the focus.", "Only the explicitly requested generic anonymous extras. No featured story identities or enacted story action."],
  "production-environment-requested": ["Reusable environment reference. Wide or medium-wide location coverage with only the people explicitly specified for this image. No additional story cast or scene action."],
  "production-main-character": ["Reusable main-character appearance reference of exactly one character, not a movie still.", body, isolated],
  "production-supporting-character": ["Reusable supporting-character appearance reference of exactly one character, independent from the rest of the cast.", body, isolated],
  "production-character-environmental": ["Exactly one character in the explicitly selected setting; no additional characters or story action.", body],
  "production-background-group": ["Reusable generic background-group reference, not an environment or a featured character portrait. Keep the group members distinct, in simple readable poses, without action or featured story identities.", "Clean neutral reference background, readable full figures, no surrounding scene or environmental clutter."],
  "production-prop": ["One isolated canonical prop/object reference. Show the complete object centered with comfortable margin, readable form, materials, color and details.", "Plain neutral studio background. No people, hands holding it, surrounding set, story action or duplicate objects."],
  "production-wardrobe": ["Standalone wardrobe/accessory product reference, unworn, displayed flat or on an invisible support. Show the complete item, fabric, cut, colors and distinctive details.", "Neutral studio background. No wearer, human body, scene action, surrounding set or duplicate items."],
};
export function productionReferencePolicy(kind: string) {
  return Object.hasOwn(productionReferencePolicies, kind) ? productionReferencePolicies[kind] : undefined;
}
