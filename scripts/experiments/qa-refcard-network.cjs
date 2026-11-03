// Isolated QA may contact local servers and the two existing rendering hosts.
// All commercial/API hosts are blocked, irrespective of app configuration.
const allowed=input=>{const raw=typeof input==='object'&&!(input instanceof URL)?String(input.hostname||input.host||'localhost').split(':')[0]:new URL(String(input)).hostname;if(!['localhost','127.0.0.1','[::1]','::1','100.75.162.64','100.98.212.116'].includes(raw))throw Error('RefCard QA blocked external host');};
const original=globalThis.fetch;globalThis.fetch=(...args)=>{allowed(args[0] instanceof Request?args[0].url:args[0]);return original(...args);};
for(const name of ['http','https']){const m=require('node:'+name);for(const key of ['request','get']){const old=m[key];m[key]=function(...args){allowed(args[0]);return old.apply(this,args);};}}
