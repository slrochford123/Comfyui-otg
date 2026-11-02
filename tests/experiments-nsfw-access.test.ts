import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {getNsfwAccess,requestNsfwAccess,setNsfwAccess,requireNsfwAccess} from "@/lib/experiments/nsfwAccess";
import {createSession,updateSession,getSession,withLab,reserveAsset,finishAsset,validateSettings} from "@/lib/experiments/store";
const fixture=vi.hoisted(()=>({users:new Set(['admin','alice','bob'])}));
vi.mock("@/lib/auth/db",()=>({ensureMigrations:()=>{},db:{prepare:()=>({get:(id:string)=>fixture.users.has(id)?{id}:undefined})}}));
vi.mock("@/lib/auth/admin",()=>({isAdminUserId:(id:string)=>id==='admin'}));
let root:string;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'h3-access-unit-'));vi.stubEnv('OTG_ENV','test');vi.stubEnv('OTG_EXPERIMENTS_ROOT',path.join(root,'lab'));vi.stubEnv('OTG_DATA_DIR',path.join(root,'data'));});
afterEach(()=>{vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
it('defaults all non-admins off, with a distinct pending request and no escalation',()=>{
  expect(getNsfwAccess('alice')).toMatchObject({enabled:false,status:'disabled',version:0});
  expect(()=>requireNsfwAccess('alice')).toThrow('disabled');
  expect(()=>requestNsfwAccess('alice',false)).toThrow('Confirm');
  expect(requestNsfwAccess('alice',true)).toMatchObject({enabled:false,status:'pending'});
  expect(requestNsfwAccess('alice',true).status).toBe('pending');
  expect(()=>setNsfwAccess('alice','alice',true,0)).toThrow('Administrator');
  expect(getNsfwAccess('bob').enabled).toBe(false);
});
it('records grant/revoke, retains media sessions, prevents stale toggles and keeps admins enabled',()=>{
  requestNsfwAccess('alice',true);const s=createSession('alice','prism-pika');
  expect(setNsfwAccess('admin','alice',true,0)).toMatchObject({enabled:true,version:1});
  expect(requireNsfwAccess('alice').enabled).toBe(true);
  expect(()=>setNsfwAccess('admin','alice',false,0)).toThrow('another window');
  expect(setNsfwAccess('admin','alice',false,1)).toMatchObject({enabled:false,status:'disabled',version:2});
  expect(getSession('alice',s.id).id).toBe(s.id);
  expect(setNsfwAccess('admin','alice',true,2).version).toBe(3);
  expect(()=>setNsfwAccess('admin','admin',false,0)).toThrow('always');
  expect(getNsfwAccess('admin')).toMatchObject({enabled:true,admin:true});
  expect(withLab(db=>db.prepare('SELECT count(*) AS n FROM h3_nsfw_access_events').get())).toEqual({n:4});
});
it('rejects missing accounts and PROD',()=>{
  expect(()=>getNsfwAccess('missing')).toThrow('Account not found');vi.stubEnv('OTG_ENV','prod');
  expect(()=>getNsfwAccess('admin')).toThrow('Not found');expect(()=>setNsfwAccess('admin','alice',true,0)).toThrow('Not found');
});
it('switches only between private H3 checkpoints while retaining settings and session identity',()=>{
  const s=createSession('alice','prism-pika');
  const v=updateSession('alice',s.id,{...s,experiment:'eros-beta7',settings:{...s.settings,prompt:'A paper boat.'}});
  expect(v.experiment).toBe('eros-beta7');expect(v.id).toBe(s.id);expect(v.settings.prompt).toBe('A paper boat.');
  expect(()=>updateSession('alice',v.id,{...v,experiment:'director-studio'})).toThrow('not available');
  expect(()=>updateSession('bob',v.id,{...v,experiment:'prism-pika'})).toThrow('not found');
  const testing=createSession('alice','pika-flex');expect(()=>updateSession('alice',testing.id,{...testing,experiment:'prism-pika'})).toThrow('not available');
});
it('persists ordered references, removal and restore without deleting any source',()=>{
  const s=createSession('alice','prism-pika');
  const first=reserveAsset('alice',s.id,'first.png','image/png','source'), second=reserveAsset('alice',s.id,'second.png','image/png','source');
  for(const a of [first,second])finishAsset('alice',a.id,8,'a'.repeat(64));
  let v=updateSession('alice',s.id,{...s,settings:{...s.settings,selectedSources:[second.id,first.id]}});
  expect(getSession('alice',s.id).settings.selectedSources).toEqual([second.id,first.id]);
  v=updateSession('alice',s.id,{...v,settings:{...v.settings,selectedSources:[]}});
  expect(getSession('alice',s.id).assets).toHaveLength(2);
  expect(getSession('alice',s.id).settings.selectedSources).toEqual([]);
  v=updateSession('alice',s.id,{...v,settings:{...v.settings,selectedSources:[first.id]}});
  expect(v.settings.selectedSources).toEqual([first.id]);
});
it('rejects duplicate, foreign, pending and comparison references; legacy settings remain compatible',()=>{
  const s=createSession('alice','prism-pika'), other=createSession('bob','prism-pika');
  const foreign=reserveAsset('bob',other.id,'other.png','image/png','source');finishAsset('bob',foreign.id,8,'a'.repeat(64));
  const pending=reserveAsset('alice',s.id,'pending.png','image/png','source');
  const comparison=reserveAsset('alice',s.id,'comparison.png','image/png','comparison');finishAsset('alice',comparison.id,8,'a'.repeat(64));
  expect(validateSettings(s.settings)).not.toHaveProperty('selectedSources');
  for(const selectedSources of [[foreign.id],[pending.id],[comparison.id],[pending.id,pending.id],['bad-id']])expect(()=>updateSession('alice',s.id,{...s,settings:{...s.settings,selectedSources}})).toThrow();
  expect(getSession('alice',s.id).revision).toBe(s.revision);
});
it('persists the optional seed lock without rewriting legacy settings or accepting truthy strings',()=>{
  const s=createSession('alice','prism-pika');
  expect(validateSettings(s.settings)).not.toHaveProperty('seedLocked');
  const locked=updateSession('alice',s.id,{...s,settings:{...s.settings,seedLocked:true,seed:0}});
  expect(getSession('alice',s.id).settings).toMatchObject({seedLocked:true,seed:0});
  updateSession('alice',s.id,{...locked,settings:{...locked.settings,seedLocked:false}});
  expect(getSession('alice',s.id).settings).toMatchObject({seedLocked:false,seed:0});
  for(const value of ['false',1,null,{}])expect(()=>validateSettings({...s.settings,seedLocked:value})).toThrow('seed lock');
});
