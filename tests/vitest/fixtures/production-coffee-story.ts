import { emptySegment, type StoryPreview } from "@/lib/productionStudio/storyPreview";
export function coffeeStory(night = false): StoryPreview {
  const titles = ["A Quiet Morning", "An Unexpected Arrival", "The Threat", "A Courageous Response", "Help Arrives", "A New Beginning"];
  const action = ["Maya enjoys coffee while Leo wipes the counter.", "A robber enters the cafe and blocks the doorway.", "Maya notices the weapon and quietly signals Leo.", "Maya disarms the robber as Leo guides the customers to safety.", "Police enter, secure the weapon and escort the robber outside.", "Outside the cafe, Maya and Leo share a relieved smile as their neighbors applaud."];
  return { schemaVersion: 1, version: night ? 2 : 1, source: "ai", title: "Coffee Shop", summary: "An ordinary cafe visit becomes a story of courage and community.", targetSeconds: 60,
    segments: [8,7,4,13,12,16].map((duration, i) => ({ ...emptySegment(`beat-${i + 1}`, duration), sceneId: i < 5 ? "cafe-interior" : "cafe-exterior",
      title: night && i === 0 ? "A Quiet Night" : titles[i], narrative: `${night ? "Under warm lamps at night" : "In the gentle morning light"}, ${action[i]}`,
      purpose: i === 0 ? "Establish Maya and Leo's peaceful routine." : "Advance the cafe confrontation toward a safe resolution.",
      location: i < 5 ? "Cafe interior" : "Cafe entrance", timeOfDay: night ? "Night" : "Morning", lighting: night ? "Warm practical lamps and cool streetlight" : "Soft morning daylight through the windows",
      emotionalTone: i < 2 ? "Quiet anticipation" : i < 4 ? "Tense and courageous" : "Relief and gratitude",
      characters: ["Maya", "Leo", ...(i > 0 && i < 5 ? ["Robber"] : [])], plotline: action[i],
      continuity: [`Keep Maya's blue coat and Leo's apron unchanged.`, night ? "Maintain nighttime lamps and the dark windows in adjacent shots." : "Maintain morning daylight across adjacent shots."],
      dialogue: i === 0 ? [{ speaker:"Maya",line:"A peaceful start, at last.",delivery:"Relaxed",startSeconds:1,endSeconds:4 }] : [],
      music: i < 2 ? "Quiet piano" : "Restrained suspense strings, resolving softly", soundEffects: i === 1 ? "Door bell rings" : "Cups and footsteps", ambience: "Low cafe conversation", cameraFraming: "Medium shot", cameraMovement: "Gentle push in",
    })) };
}
