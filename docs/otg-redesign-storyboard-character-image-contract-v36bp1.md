# OTG Storyboard Redesign + Character Image Contract v36bp1

## Storyboard redesign progress saved

Completed and accepted as the current reset direction:

- `v36bo5a`: added `POST /api/production/picture/scene-pass`.
- `v36bo5b`: replaced the unstable legacy Storyboard UI with isolated `QwenSceneBuilderPanel`.
- `v36bo5c`: prepared asset bridge patch for Character Gallery / Background Gallery / Object picker in the new Storyboard UI.

Current Storyboard architecture target:

1. Storyboard creates up to 8 completed scene images.
2. Each scene can be built through up to 10 prompt passes.
3. Each pass supports max 3 input images total.
4. Background counts as one image.
5. Character counts as one image.
6. Object/prop counts as one image.
7. After pass 1, previous output becomes a locked base image and counts as one image.
8. Submit Prompt sends a clean `Next Scene:` prompt to the direct scene-pass route.
9. Preview belongs under the prompt card, not in a top Scene Output block.
10. Completed scenes must be written to a shared production manifest before Animate handoff.

Next Storyboard work:

- Confirm/run `v36bo5c` asset bridge.
- Wire exact app character/background/object APIs if the bridge does not discover assets.
- Save completed scenes into a shared production manifest.
- Make Animate consume completed Storyboard scenes.

## Character tab image contract

The Character tab must distinguish two images:

### 1. Character card / workflow image

This is the selected/generated ComfyUI character-card image.

Use this image for:

- Storyboard Qwen workflow input.
- Production image reference slot.
- Any workflow that needs the full original character-card composition.

Do **not** replace this with the background-removed profile image when sending to Storyboard.

Suggested field names:

- `characterCardImage`
- `characterCardWorkflowImage`
- `characterCardPreviewUrl`

### 2. Default character profile image

This is the background-removed version created from the selected character-card image.

Use this image for:

- Character profile display.
- Character selection thumbnail.
- Character identity/profile view.
- Character description UI preview.

Suggested field names:

- `defaultCharacterImage`
- `defaultCharacterImageWorkflow`
- `defaultCharacterPreviewUrl`
- `backgroundRemovedDefaultImage`

## Required Character creation flow

1. User creates/generates character image.
2. User selects one returned image to become the character card.
3. App saves that selected image as the character card/workflow image.
4. App sends that selected image into the remove-background flow.
5. Remove-background result is saved as the default character profile image.
6. Character card remains the workflow image for Storyboard.
7. Default character image is only the display/profile/thumbnail image.

## Known current gap

The app currently appears to save only the character card. It does not yet persist a background-removed default character image.

## Implementation requirement for next functional patch

Find the exact Character save path and background-removal route/workflow, then patch Character save so the saved character record includes both:

```ts
{
  characterCardImage: string;
  characterCardWorkflowImage: string;
  defaultCharacterImage: string;
  defaultCharacterImageWorkflow?: string;
}
```

If no existing background-removal route exists, add one as a separate route and call it from Character save.
