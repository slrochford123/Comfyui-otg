// Prepare only original QA media in the observed TEST browser owner's gallery.
// Does not change authentication, permissions, existing media, or PROD.
const fs=require("node:fs"),path=require("node:path");
const pid=Number(process.argv[2]),username=String(process.argv[3]||"");
if(!/^[a-zA-Z0-9_-]{3,128}$/.test(username)||!Number.isInteger(pid))throw Error("Invalid TEST fixture target");
const env=Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`,"utf8").split("\0").filter(Boolean).map(x=>{const i=x.indexOf("=");return [x.slice(0,i),x.slice(i+1)];}));
if(env.OTG_ENV!=="test")throw Error("TEST only");
const aliases=new Map(String(env.OTG_OWNER_ALIASES||"").split(",").map(s=>s.split(":")));
const owner=aliases.get(username.toLowerCase())||username;
if(!/^[a-zA-Z0-9_-]{3,128}$/.test(owner))throw Error("Invalid owner alias");
const audio=process.argv[4]==="audio";
const directory=audio?path.join(env.OTG_DATA_DIR,"edit_video","music",owner.toLowerCase(),"library"):path.join(env.OTG_DATA_DIR,"user_galleries",owner.toLowerCase());
fs.mkdirSync(directory,{recursive:true});
const name=`audio-qa-original-${Date.now()}${audio?".wav":".mp4"}`;
fs.copyFileSync(audio?"/home/shawn-rochford/AI/runtime/test/unified-audio/evidence/native/ace-private-3090-r1/music.wav":"/home/shawn-rochford/AI/runtime/test/unified-audio/evidence/native/conversation-5s.mp4",path.join(directory,name),fs.constants.COPYFILE_EXCL);
console.log(JSON.stringify({testOnly:true,name,source:audio?"Original locally generated ACE-Step QA music; existing user media retained":"Original procedural development fixture; no existing user media changed"}));
