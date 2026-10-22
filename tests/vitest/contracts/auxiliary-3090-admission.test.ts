import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
const state=vi.hoisted(()=>({busy:"",peerFailure:false,voiceBusy:false}));
vi.mock("@/lib/workers/resourceLocks",()=>({
  acquireResourceLock:vi.fn((args:any)=>args.lockId===state.busy?{ok:false}:{ok:true,lock:{...args,fencingToken:"qa-fence"}}),
  releaseResourceLock:vi.fn(()=>true),heartbeatResourceLock:vi.fn(()=>({})),
  listResourceLocks:vi.fn(()=>state.busy?[{lockId:state.busy}]:[]),
}));
vi.mock("@/lib/workers/voiceGpuFileLease",()=>({voiceGpuFileBusy:()=>state.voiceBusy,acquireVoiceGpuFileLease:vi.fn(async()=>{if(state.voiceBusy)throw Error("RTX 3090 is busy with an active voice operation.");return ()=>{};})}));
vi.mock("@/lib/workers/comfy3090Peer",()=>({releaseIdle3090Peer:vi.fn(async()=>{if(state.peerFailure)throw Error("Cannot verify the other 3090 worker");})}));
import {acquireAuxiliary3090,auxiliary3090Busy,AuxiliaryGpuBusyError} from "@/lib/workers/auxiliary3090Lease";
import {releaseResourceLock,heartbeatResourceLock} from "@/lib/workers/resourceLocks";
import {releaseIdle3090Peer} from "@/lib/workers/comfy3090Peer";
beforeEach(()=>{vi.clearAllMocks();state.busy="";state.peerFailure=false;state.voiceBusy=false;});
afterEach(()=>vi.useRealTimers());
describe("Auxiliary audio shares the physical 3090 admission domain",()=>{
  it("holds video admission and GPU locks while releasing only verified idle peer caches",async()=>{
    const release=await acquireAuxiliary3090("qa-audio");
    expect(vi.mocked(releaseIdle3090Peer).mock.calls.map(x=>x[0])).toEqual(["http://100.75.162.64:8189","http://100.75.162.64:8188"]);
    expect(releaseResourceLock).not.toHaveBeenCalled();release();release();expect(releaseResourceLock).toHaveBeenCalledTimes(2);
  });
  it.each(["comfy-submit:shawn-3090","gpu:shawn-3090"])("fails closed before any cache action when %s is owned",async lock=>{
    state.busy=lock;await expect(acquireAuxiliary3090("qa-audio")).rejects.toBeInstanceOf(AuxiliaryGpuBusyError);expect(releaseIdle3090Peer).not.toHaveBeenCalled();
    expect(releaseResourceLock).toHaveBeenCalledTimes(lock.startsWith("gpu:")?1:0);
  });
  it("releases its locks if queue state cannot be proven; never interrupts a worker",async()=>{
    state.peerFailure=true;await expect(acquireAuxiliary3090("qa-audio")).rejects.toThrow("Cannot verify");expect(releaseResourceLock).toHaveBeenCalledTimes(2);
  });
  it("heartbeats the render-duration lease and stops heartbeats on completion",async()=>{
    vi.useFakeTimers();const release=await acquireAuxiliary3090("qa-audio");await vi.advanceTimersByTimeAsync(30000);expect(heartbeatResourceLock).toHaveBeenCalledTimes(2);release();await vi.advanceTimersByTimeAsync(30000);expect(heartbeatResourceLock).toHaveBeenCalledTimes(2);
  });
  it("blocks an existing Python voice operation before touching Comfy caches",async()=>{
    state.voiceBusy=true;await expect(acquireAuxiliary3090("qa-audio")).rejects.toThrow("busy");expect(releaseIdle3090Peer).not.toHaveBeenCalled();expect(releaseResourceLock).toHaveBeenCalledTimes(2);
    expect(await auxiliary3090Busy()).toBe(true);
  });
  it("does not call a model ready while Comfy is using the same GPU",async()=>{
    const f=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>Response.json({queue_running:[[1,"qa"]],queue_pending:[]}));
    try{expect(await auxiliary3090Busy()).toBe(true);}finally{f.mockRestore();}
  });
  it("fails closed if queue state cannot be verified",async()=>{
    const f=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>Response.json({}, {status:503}));
    try{await expect(auxiliary3090Busy()).rejects.toThrow("Cannot verify");}finally{f.mockRestore();}
  });
});
