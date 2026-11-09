import { coffeeStory } from "./production-coffee-story";
export function miaStory() {
  const story=coffeeStory();
  story.segments[0].characters.push("Mia — best friend, heard only over the phone; appearance not established");
  story.segments[0].narrative += " Mia speaks with Maya over the phone.";
  story.segments[0].dialogue.push({speaker:"Mia",line:"Are you at the coffee shop?",delivery:"Over the phone",startSeconds:4,endSeconds:7});
  return story;
}
export function miaInventory() { return {items:[
  {kind:"environment",name:"Coffee Shop",role:"location",description:"Coffee shop interior in morning daylight",prompt:"Coffee shop interior in morning daylight",sourceSegmentIds:["beat-1"],continuity:[],evidence:"Cafe interior",optional:false,question:""},
  {kind:"character",name:"Maya",role:"main",description:"Maya's blue coat",prompt:"Maya in a blue coat",sourceSegmentIds:["beat-1"],continuity:[],evidence:"Maya",optional:false,question:""},
  {kind:"character",name:"Mia",role:"best friend, phone voice",description:"",prompt:"",sourceSegmentIds:["beat-1"],continuity:[],evidence:"Mia",optional:false,question:"What should Mia look like if shown later?"},
  {kind:"prop",name:"Coffee Cup",role:"prop",description:null,prompt:null,sourceSegmentIds:["beat-1"],continuity:[],evidence:"coffee",optional:true,question:""}
]}; }
