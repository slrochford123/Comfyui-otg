// Offline audit tests must never consume paid APIs or contact live GPU workers.
const allowed = input => {
  const host = typeof input === 'object' && !(input instanceof URL) ? String(input.hostname || input.host || 'localhost').split(':')[0] : new URL(String(input)).hostname;
  if (!['localhost','127.0.0.1','[::1]','::1'].includes(host)) throw new Error('Offline audit blocked external request: ' + host);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = (...args) => { allowed(args[0] instanceof Request ? args[0].url : args[0]); return originalFetch(...args); };
for (const name of ['http','https']) {
  const mod = require('node:' + name);
  for (const method of ['request','get']) { const original = mod[method]; mod[method] = function(...args) { allowed(args[0]); return original.apply(this,args); }; }
}
