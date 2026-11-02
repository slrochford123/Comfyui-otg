import fs from 'node:fs';
import {describe,it,expect} from 'vitest';

describe('H3 deep-link navigation',()=>{
  it('accepts the H3 query tab alongside persisted and navigation selections',()=>{
    const source=fs.readFileSync('app/app/AppPageClient.tsx','utf8');
    const query=source.slice(source.indexOf('const rawTabParam ='),source.indexOf('setTab(tabParam);'));
    expect(query).toContain('tabParam === "h3"');
  });
});
