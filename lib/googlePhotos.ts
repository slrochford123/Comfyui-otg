import {createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import {readFileSync} from "node:fs";
import path from "node:path";
import {OTG_DATA_ROOT} from "./paths";

export const GOOGLE_PHOTOS_SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";
const API = "https://photospicker.googleapis.com/v1";
const TOKEN = "https://oauth2.googleapis.com/token";
const MAX_AGE = 10 * 60_000;
type Tokens = {access_token: string; refresh_token?: string; expires: number; scope: string; generation: string};
type Attempt = {owner: string; verifier: string; expires: number; claimed?: boolean; tokens?: Tokens; error?: string};
type Media = {id: string; name: string; mime: string; baseUrl: string};
type Picking = {id: string; expires: number; maximum: number; accept: string; media?: Media[]; pollAfter?: number; pickerUri: string};
export class PhotosError extends Error {constructor(message: string, public status = 400) {super(message);}}
export function googlePhotosConfiguration() {
  let saved:{clientId?:string;clientSecret?:string;redirectUri?:string}={};
  const file=path.join(OTG_DATA_ROOT,"google-photos","configuration.json");
  try{saved=decrypt(file,JSON.parse(readFileSync(file,"utf8")));}catch{}
  const clientId = process.env.OTG_GOOGLE_PHOTOS_CLIENT_ID?.trim() || saved.clientId;
  const clientSecret = process.env.OTG_GOOGLE_PHOTOS_CLIENT_SECRET?.trim() || saved.clientSecret;
  const redirectUri = process.env.OTG_GOOGLE_PHOTOS_REDIRECT_URI?.trim() || saved.redirectUri;
  let valid = false;
  try {const u=new URL(redirectUri || ""); valid=u.protocol==="https:" && u.pathname==="/api/integrations/google-photos/callback" && !u.search && !u.hash;} catch {}
  return {configured: !!(clientId && clientSecret && valid && process.env.AUTH_SECRET), clientId, clientSecret, redirectUri};
}
export async function configureGooglePhotos(client:unknown,redirectUri:string){
  const web=(client as {web?:{client_id?:unknown;client_secret?:unknown;redirect_uris?:unknown}})?.web;
  if(!web || typeof web.client_id!=="string" || typeof web.client_secret!=="string" || !Array.isArray(web.redirect_uris) || !web.redirect_uris.includes(redirectUri))throw new PhotosError("Upload a Google Web application OAuth client JSON containing this exact authorized redirect URI.");
  let valid=false;try{const u=new URL(redirectUri);valid=u.protocol==="https:" && !u.username && !u.password && !u.hash && !u.search && u.pathname==="/api/integrations/google-photos/callback";}catch{}
  if(!valid)throw new PhotosError("Use your TEST site's HTTPS URL followed by /api/integrations/google-photos/callback.");
  await write(path.join(OTG_DATA_ROOT,"google-photos","configuration.json"),{clientId:web.client_id,clientSecret:web.client_secret,redirectUri});
  return {configured:true};
}
function config() {const c=googlePhotosConfiguration(); if(!c.configured) throw new PhotosError("Google Photos needs administrator setup. Phone storage and the device Photos picker are still available.",503); return c;}
function fileFor(kind: string, owner: string, id = "connection") {
  const ownerHash=createHash("sha256").update(owner).digest("hex");
  return path.join(OTG_DATA_ROOT,"google-photos",kind,ownerHash,createHash("sha256").update(id).digest("hex")+".json");
}
function cryptKey() {
  if(!process.env.AUTH_SECRET) throw new PhotosError("Google Photos encryption is unavailable.",503);
  return createHash("sha256").update("otg-google-photos-v1\0"+process.env.AUTH_SECRET).digest();
}
async function write(file: string, value: unknown) {
  const nonce=randomBytes(12),cipher=createCipheriv("aes-256-gcm",cryptKey(),nonce);
  cipher.setAAD(Buffer.from(file));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const temporary=file+"."+randomUUID();
  await fs.writeFile(temporary,JSON.stringify({nonce:nonce.toString("base64"),tag:cipher.getAuthTag().toString("base64"),data:encrypted.toString("base64")}),{mode:0o600});
  await fs.rename(temporary,file);
}
function decrypt<T>(file:string,value:{nonce:string;tag:string;data:string}):T{
    const decipher=createDecipheriv("aes-256-gcm",cryptKey(),Buffer.from(value.nonce,"base64"));
    decipher.setAAD(Buffer.from(file));decipher.setAuthTag(Buffer.from(value.tag,"base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data,"base64")),decipher.final()]).toString());
}
async function read<T>(file: string): Promise<T | null> {
  try {
    return decrypt<T>(file,JSON.parse(await fs.readFile(file,"utf8")));
  } catch(error) {if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw new PhotosError("Google Photos connection could not be read. Disconnect and reconnect.",503);}
}
const connectionFile=(owner:string)=>fileFor("connections",owner);
const attemptFile=(id:string)=>fileFor("attempts","oauth",id);
function validateId(id: string) {if(!/^[A-Za-z0-9_-]{20,128}$/.test(id))throw new PhotosError("Invalid Google Photos session.");}
async function tokenRequest(values: Record<string,string>) {
  const c=config();const response=await fetch(TOKEN,{method:"POST",body:new URLSearchParams({client_id:c.clientId!,client_secret:c.clientSecret!,...values}),signal:AbortSignal.timeout(20_000),cache:"no-store",redirect:"error"});
  const data=await response.json();
  if(!response.ok || !data.access_token) throw new PhotosError("Google authorization expired or was declined. Reconnect Google Photos.",401);
  if(data.scope && !String(data.scope).split(" ").includes(GOOGLE_PHOTOS_SCOPE))throw new PhotosError("Google Photos access was not granted. Your app account is unchanged.",403);
  return {access_token:String(data.access_token),refresh_token:data.refresh_token?String(data.refresh_token):undefined,expires:Date.now()+Math.max(1,Number(data.expires_in)||3600)*1000,scope:String(data.scope||GOOGLE_PHOTOS_SCOPE),generation:randomUUID()} satisfies Tokens;
}
export async function beginGooglePhotos(owner: string) {
  const c=config(),attempt=randomBytes(32).toString("base64url"),verifier=randomBytes(48).toString("base64url");
  await write(attemptFile(attempt),{owner,verifier,expires:Date.now()+MAX_AGE} satisfies Attempt);
  const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search=new URLSearchParams({client_id:c.clientId!,redirect_uri:c.redirectUri!,response_type:"code",scope:GOOGLE_PHOTOS_SCOPE,state:attempt,code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256",access_type:"offline",prompt:"consent select_account"}).toString();
  return {authorizationUrl:url.toString(),attempt};
}
export async function completeGooglePhotos(attempt: string, code: string, denied = false) {
  validateId(attempt);const file=attemptFile(attempt),pending=await read<Attempt>(file);
  if(!pending || pending.expires<Date.now() || pending.claimed) throw new PhotosError("This Google connection request expired. Return to Settings and try again.");
  // Consume the state before exchange. Tokens are not linked until the original,
  // authenticated app session claims this attempt (browser/WebView cookie isolation).
  await write(file,{...pending,claimed:true});
  if(denied){await write(file,{...pending,claimed:true,error:"Google Photos permission was declined."});return;}
  if(!code || code.length>4096)throw new PhotosError("Google did not return an authorization code.");
  try {const tokens=await tokenRequest({code,code_verifier:pending.verifier,redirect_uri:config().redirectUri!,grant_type:"authorization_code"});await write(file,{...pending,claimed:true,tokens});}
  catch(error){await write(file,{...pending,claimed:true,error:"Google Photos authorization failed. Start a new connection."});throw error;}
}
export async function googlePhotosStatus(owner: string, attempt?: string) {
  let connecting=false;
  if(attempt){
    validateId(attempt);const pending=await read<Attempt>(attemptFile(attempt));
    if(!pending || pending.owner!==owner || pending.expires<Date.now())throw new PhotosError("This Google connection request expired. Connect again.");
    if(pending.error)throw new PhotosError(pending.error);
    if(pending.tokens){await write(connectionFile(owner),pending.tokens);await fs.unlink(attemptFile(attempt));}
    else connecting=true;
  }
  const tokens=await read<Tokens>(connectionFile(owner));
  return {configured:googlePhotosConfiguration().configured,connected:!!tokens && (!!tokens.refresh_token || tokens.expires>Date.now()),connecting};
}
export async function disconnectGooglePhotos(owner: string) {
  const tokens=await read<Tokens>(connectionFile(owner));
  // Remove local credentials even if Google's revocation endpoint is unavailable.
  await fs.unlink(connectionFile(owner)).catch(error=>{if(error.code!=="ENOENT")throw error;});
  const attempts=path.dirname(attemptFile("index"));
  for(const name of await fs.readdir(attempts).catch(()=>[])){
    if(!name.endsWith(".json"))continue;
    const file=path.join(attempts,name),attempt=await read<Attempt>(file);
    if(attempt?.owner===owner)await write(file,{...attempt,tokens:undefined,error:"Google Photos connection canceled.",claimed:true});
  }
  let revoked=!tokens;
  if(tokens){try{const response=await fetch("https://oauth2.googleapis.com/revoke",{method:"POST",body:new URLSearchParams({token:tokens.refresh_token||tokens.access_token}),signal:AbortSignal.timeout(10_000)});revoked=response.ok;}catch{}}
  return {revoked};
}
/** Called only after the existing password-confirmed application account deletion. */
export async function deleteGooglePhotosAccount(owner:string){
  await disconnectGooglePhotos(owner).catch(()=>{});
  // Every target is a fixed provider subdirectory plus a SHA256 owner segment,
  // never a browser path. Project-wide OAuth configuration belongs to all users.
  for(const kind of ["connections","picking"]){
    const directory=path.dirname(fileFor(kind,owner));
    if(!/^[a-f0-9]{64}$/.test(path.basename(directory)))throw new PhotosError("Invalid Google account storage boundary.");
    await fs.rm(directory,{recursive:true,force:true});
  }
  const attempts=path.dirname(attemptFile("index"));
  for(const name of await fs.readdir(attempts).catch(()=>[])){
    if(!name.endsWith(".json"))continue;
    const file=path.join(attempts,name),attempt=await read<Attempt>(file).catch(()=>null);
    if(attempt?.owner===owner)await fs.unlink(file);
  }
}
async function accessToken(owner: string) {
  const file=connectionFile(owner),tokens=await read<Tokens>(file);
  if(!tokens)throw new PhotosError("Connect Google Photos in Settings first.",401);
  if(tokens.expires>Date.now()+60_000)return tokens.access_token;
  if(!tokens.refresh_token)throw new PhotosError("Reconnect Google Photos in Settings.",401);
  const next=await tokenRequest({grant_type:"refresh_token",refresh_token:tokens.refresh_token});
  if((await read<Tokens>(file))?.generation!==tokens.generation)throw new PhotosError("Google connection changed. Try again.",409);
  await write(file,{...next,refresh_token:next.refresh_token||tokens.refresh_token});return next.access_token;
}
async function api(owner:string,endpoint:string,init:RequestInit={}) {
  const response=await fetch(API+endpoint,{...init,headers:{"Content-Type":"application/json",Authorization:`Bearer ${await accessToken(owner)}`},signal:AbortSignal.timeout(20_000),cache:"no-store",redirect:"error"});
  if(!response.ok)throw new PhotosError(response.status===401?"Reconnect Google Photos in Settings.":response.status===403?"Enable the Photos Picker API and approve its access in Google Cloud.":"Google Photos could not complete the request. Try again.",response.status===401?401:502);
  return response.json();
}
export async function beginGooglePicking(owner:string,maximum:number,accept:string) {
  if(!Number.isInteger(maximum)||maximum<1||maximum>16)throw new PhotosError("Choose between 1 and 16 media items, within this workflow's remaining slots.");
  const data=await api(owner,"/sessions",{method:"POST",body:JSON.stringify({pickingConfig:{maxItemCount:String(maximum)}})});
  validateId(data.id);const uri=new URL(data.pickerUri);
  if(uri.protocol!=="https:"||uri.hostname!=="photos.google.com")throw new PhotosError("Google returned an invalid picker address.",502);
  const picking:Picking={id:data.id,maximum,accept:String(accept).slice(0,512),expires:Math.min(Date.parse(data.expireTime)||Date.now()+30*60_000,Date.now()+30*60_000),pickerUri:uri.toString()};
  await write(fileFor("picking",owner,data.id),picking);
  return {id:data.id,pickerUri:uri.toString(),pollAfterMs:Math.max(1000,Number.parseFloat(data.pollingConfig?.pollInterval||"5s")*1000)};
}
export async function googlePickingStatus(owner:string,id:string) {
  validateId(id);const file=fileFor("picking",owner,id),session=await read<Picking>(file);
  if(!session||session.expires<Date.now())throw new PhotosError("Google Photos selection expired. Choose your media again.",404);
  if(session.media)return {ready:true,items:session.media.map(({id,name,mime})=>({id,name,mime}))};
  if(session.pollAfter && session.pollAfter>Date.now())return {ready:false,pollAfterMs:session.pollAfter-Date.now()};
  const data=await api(owner,"/sessions/"+encodeURIComponent(id));
  const pollAfterMs=Math.max(1000,Number.parseFloat(data.pollingConfig?.pollInterval||"5s")*1000);
  if(!data.mediaItemsSet){
    if(data.pollingConfig?.timeoutIn==="0s")throw new PhotosError("Google Photos selection timed out. Choose your media again.");
    await write(file,{...session,pollAfter:Date.now()+pollAfterMs});return {ready:false,pollAfterMs};
  }
  const media:Media[]=[];let page="";
  do {
    const result=await api(owner,"/mediaItems?"+new URLSearchParams({sessionId:id,pageSize:"100",...(page?{pageToken:page}:{})}));
    for(const item of result.mediaItems||[]){
      const m=item.mediaFile; if(!m?.baseUrl||!m?.mimeType||!['image','video'].includes(String(m.mimeType).split('/')[0]))throw new PhotosError("Google returned an unsupported media item.",502);
      if(m.mimeType.startsWith("video/") && m.mediaFileMetadata?.videoMetadata?.processingStatus && m.mediaFileMetadata.videoMetadata.processingStatus!=="READY")throw new PhotosError("A selected Google video is still processing. Choose it after Google Photos finishes preparing it.",409);
      media.push({id:String(item.id),name:String(m.filename||"google-photo").replace(/[\x00-\x1f\x7f/\\]/g,"_").slice(0,180),mime:String(m.mimeType),baseUrl:String(m.baseUrl)});
    }
    if(media.length>session.maximum)throw new PhotosError(`This workflow has room for ${session.maximum} items. Choose fewer; nothing was discarded.`);
    page=String(result.nextPageToken||"");
  } while(page);
  await write(file,{...session,media});return {ready:true,items:media.map(({id,name,mime})=>({id,name,mime}))};
}
export async function downloadGoogleMedia(owner:string,sessionId:string,itemId:string) {
  validateId(sessionId);const session=await read<Picking>(fileFor("picking",owner,sessionId));
  const media=session?.media?.find(item=>item.id===itemId);
  if(!session || session.expires<Date.now() || !media)throw new PhotosError("Selected media is unavailable for this account. Choose it again.",404);
  const url=new URL(media.baseUrl);
  if(url.protocol!=="https:" || url.username || url.password || url.port || !(url.hostname==="googleusercontent.com"||url.hostname.endsWith(".googleusercontent.com")))throw new PhotosError("Invalid Google media address.",502);
  const response=await fetch(url.toString()+(media.mime.startsWith("video/")?"=dv":"=d"),{headers:{Authorization:`Bearer ${await accessToken(owner)}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(120_000)});
  if(!response.ok||!response.body)throw new PhotosError("Google media could not be downloaded. It may still be processing.",502);
  const maximum=128*1024*1024,reader=response.body.getReader(),parts:Uint8Array[]=[];let bytes=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maximum)throw new PhotosError("This cloud file exceeds 128 MB. Use a smaller copy or Phone storage.",413);parts.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  return {bytes:Buffer.concat(parts),mime:media.mime,name:media.name};
}
