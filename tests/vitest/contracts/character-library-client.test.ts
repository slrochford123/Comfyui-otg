import {expect,it,vi} from "vitest";
import {loadSavedCharacters} from "@/lib/characters/libraryClient";

it("loads through the authenticated cookie without device storage",async()=>{
  const fetcher=vi.fn(async()=>Response.json({ok:true,items:[{id:"helena"}]}));
  expect(await loadSavedCharacters(new AbortController().signal,fetcher)).toEqual([{id:"helena"}]);
  expect(fetcher.mock.calls[0]).toMatchObject([expect.stringContaining("/api/characters?"),{
    credentials:"include",cache:"no-store",headers:{Accept:"application/json"},
  }]);
});
it("recovers once from a proxy HTML response or connection interruption",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response("<html>reconnecting</html>",{status:502}))
    .mockResolvedValueOnce(Response.json({ok:true,items:[{id:"saved"}]}));
  expect(await loadSavedCharacters(new AbortController().signal,fetcher)).toEqual([{id:"saved"}]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("shows a session recovery message and stops an aborted load",async()=>{
  const fetcher=vi.fn(async()=>new Response(null,{status:401}));
  await expect(loadSavedCharacters(new AbortController().signal,fetcher)).rejects.toThrow(/Sign in again/);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const controller=new AbortController();controller.abort();
  const aborted=vi.fn(async()=>{throw new DOMException("Aborted","AbortError");});
  await expect(loadSavedCharacters(controller.signal,aborted)).rejects.toMatchObject({name:"AbortError"});
  expect(aborted).toHaveBeenCalledTimes(1);
});
