import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks=vi.hoisted(()=>({ session:vi.fn(),sidecar:vi.fn() }));
vi.mock('@/lib/sessionUser',()=>({ requireSessionUser:mocks.session }));
vi.mock('@/lib/h3SpecialModes/refModCreation',()=>({ readH3RefModSidecar:mocks.sidecar }));
import { GET } from '@/app/api/h3/special/refmods/library/route';
beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue({ ownerKey:'qa' });vi.stubGlobal('fetch',vi.fn(async()=>Response.json([])));});
afterEach(()=>vi.unstubAllGlobals());
describe('selected GPU RefMods library',()=>{
  it('denies anonymous access before worker access',async()=>{mocks.session.mockRejectedValue(Error('private-session'));expect((await GET(new NextRequest('http://test/api/h3/special/refmods/library?backend=rtx5060ti'))).status).toBe(401);expect(fetch).not.toHaveBeenCalled();});
  it('rejects arbitrary host/target values',async()=>{expect((await GET(new NextRequest('http://test/api/h3/special/refmods/library?backend=http://arbitrary'))).status).toBe(400);expect(fetch).not.toHaveBeenCalled();});
  it('queries the selected 5060 library, without treating 3090 local sidecars as remote metadata',async()=>{
    const response=await GET(new NextRequest('http://test/api/h3/special/refmods/library?backend=rtx5060ti'));
    expect(response.status).toBe(200);expect(fetch).toHaveBeenCalledWith('http://100.98.212.116:8188/refmods/library',expect.anything());expect(mocks.sidecar).not.toHaveBeenCalled();expect((await response.json()).backend).toBe('rtx5060ti');
  });
});
