import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { sameComfyWorker } from "@/lib/workers/comfyWorkerInstance";
describe("trusted Comfy worker incarnation proof",()=>{
  it("includes boot identity and process start ticks, not PID alone",()=>{
    const a={host:"shawn",unit:"otg-comfyui-h3.service",pid:42,startTicks:"1",bootId:"a"};
    expect(sameComfyWorker(a,{...a})).toBe(true);
    for(const patch of [{pid:43},{startTicks:"2"},{bootId:"b"},{unit:"otg-comfyui.service"},{host:"slr"}])expect(sameComfyWorker(a,{...a,...patch})).toBe(false);
  });
  it("the fixed read-only helper rejects unsafe targets and verifies death, PID reuse, boots and service races",()=>{
    const python=String.raw`
import importlib.util, json
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('probe','scripts/comfy-worker-instance.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
old=dict(host='shawn',unit='otg-comfyui-h3.service',pid=11,startTicks='100',bootId='old')
packet=dict(baseUrl='http://100.75.162.64:8189',previous=old)
def text(p,*a,**kw):
 if str(p).endswith('boot_id'):return 'old\n'
 raise AssertionError(str(p))
with patch.object(m.socket,'gethostname',return_value='shawn'),patch.object(m.subprocess,'check_output',return_value='MainPID=22\nActiveState=active\n'),patch.object(m.Path,'read_text',text),patch.object(m.Path,'read_bytes',return_value=b'python\x00/candidate/main.py\x00--port\x008189\x00'):
 for previous_ticks,stopped in [('100',False),(None,True),('999',True)]:
  with patch.object(m,'start_ticks',side_effect=lambda pid:'200' if pid==22 else previous_ticks):assert m.probe(packet)['previousStopped']==stopped
 with patch.object(m,'start_ticks',return_value='200'):
  assert m.probe(dict(packet,previous=dict(old,bootId='different')))['previousStopped'] is True
  for bad in [dict(baseUrl='http://evil:8189'),dict(packet,command='kill'),dict(packet,previous=dict(old,unit='ssh.service')),dict(packet,previous=dict(old,pid='11'))]:
   try:m.probe(bad);raise AssertionError('accepted invalid probe')
   except (ValueError,KeyError):pass
  with patch.object(m.subprocess,'check_output',side_effect=['MainPID=22\nActiveState=active\n','MainPID=23\nActiveState=active\n']):
   try:m.probe(packet);raise AssertionError('accepted service race')
   except ValueError:pass
print('fixed-process-proofs-passed')
`;
    expect(execFileSync('/usr/bin/python3',['-c',python],{encoding:'utf8'}).trim()).toBe('fixed-process-proofs-passed');
  });
});
