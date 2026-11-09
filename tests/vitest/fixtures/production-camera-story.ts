import {coffeeStory} from "./production-coffee-story";
import type {StoryPreview} from "@/lib/productionStudio/storyPreview";
export function cameraStory(story:StoryPreview=coffeeStory()):StoryPreview {
 const coverage=[
  [[3,"Maya holds her cup at the counter","Medium counter view"],[3,"Leo wipes the counter beside Maya","Reverse medium view"],[2,"Maya places the cup on its saucer","Cup insert"]],
  [[4,"The robber enters through the cafe door","Wide doorway view"],[3,"Maya turns toward the ringing doorbell","Medium counter view"]],
  [[2,"Maya notices the weapon","Close-up on Maya"],[2,"Maya quietly signals Leo","Counter two-shot"]],
  [[4,"Maya knocks the weapon away","Wide action view"],[3,"The weapon slides across the floor","Low floor insert"],[6,"Leo guides customers behind the tables","Wide evacuation view"]],
  [[4,"Police enter the cafe","Wide doorway view"],[4,"An officer secures the fallen weapon","Medium floor view"],[4,"Officers escort the robber outside","Tracking doorway view"]],
  [[6,"Maya and Leo step outside and exchange relieved smiles","Exterior two-shot"],[5,"Neighbors applaud Maya","Wide exterior view"],[5,"Maya smiles as Leo stands beside her","Close two-shot"]],
 ] as const;
 return {...structuredClone(story),segments:story.segments.map((b,i)=>({...b,shots:coverage[i].map(([duration,action,framing],n)=>({id:`${b.id}-camera-${n+1}`,title:action,durationSeconds:duration,action,framing,movement:n===0?"Gentle push in":"Static",cameraSetup:framing,continuity:b.continuity}))}))};
}
