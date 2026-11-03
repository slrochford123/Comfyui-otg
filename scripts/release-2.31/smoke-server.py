"""Root-owned disposable production-mode app, never uses live auth/data or GPU inference."""
import json,os,pathlib,secrets,signal,subprocess,sys,tempfile
p=json.load(sys.stdin);stage=pathlib.Path(p['stage']);candidate=pathlib.Path(p['candidate'])
assert os.geteuid()==0 and stage.parent==pathlib.Path('/mnt/otg_bulk') and stage.name.startswith('build-2.31-promotion-')
assert candidate.parent==pathlib.Path('/opt/otg/releases') and candidate.name.startswith('prod-build-2.31-')
state=stage/'smoke-process.json'
if p.get('stop'):
 s=json.loads(state.read_text());pid=s['pid'];proc=pathlib.Path('/proc')/str(pid)
 if proc.exists():
  assert proc.joinpath('cwd').resolve()==candidate.resolve() and proc.joinpath('exe').resolve()==pathlib.Path('/opt/otg/runtime/node-v22.23.4/bin/node').resolve() and b'PORT=3308' in proc.joinpath('environ').read_bytes().split(b'\0');os.kill(pid,signal.SIGTERM)
 print(json.dumps({'stopped':True,'pid':pid}));sys.exit()
assert not (candidate/'.env.local').exists() and not (candidate/'data').exists()
data=pathlib.Path(tempfile.mkdtemp(prefix='smoke-data-',dir=stage));private=pathlib.Path(tempfile.mkdtemp(prefix='smoke-private-',dir=stage))
os.chmod(data,0o700);os.chmod(private,0o700)
# Reuse the existing trusted private-H3 transport configuration, not its sessions.
cfg=pathlib.Path(p['nsfwRoot'])/'runtime.json';private.joinpath('runtime.json').write_bytes(cfg.read_bytes());os.chmod(private/'runtime.json',0o600)
env={'OTG_AUDIO_EDITING_ENABLED':'1','OTG_PRIVATE_RESEARCH_MEDIA':'1','OTG_MEDIA_GPU_ROUTING':'1','OTG_AUDIO_ENGINE_CONFIG':p['rootEngineConfig'],'OTG_STORY_QWEN_REMOTE_CONFIG':p['speechConfig'],'PATH':'/opt/otg/runtime/node-v22.23.4/bin:/usr/bin:/bin','HOME':'/root','LANG':'C.UTF-8','NODE_ENV':'production','OTG_ENV':'prod','PORT':'3308','HOSTNAME':'127.0.0.1','AUTH_SECRET':secrets.token_hex(48),'OTG_DATA_DIR':str(data),'OTG_DATA_ROOT':str(data),'OTG_H3_NSFW_ENABLED':'1','OTG_H3_NSFW_ROOT':str(private),'OTG_H3_CHARACTER_REFCARDS_ENABLED':'1','OPENAI_ENABLED':'0','OPENAI_KILL_SWITCH':'1','NEXT_TELEMETRY_DISABLED':'1'}
with (stage/'smoke-server.private.log').open('xb') as log:
 child=subprocess.Popen(['/opt/otg/runtime/node-v22.23.4/bin/node',str(candidate/'server.js')],cwd=candidate,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
state.write_text(json.dumps({'pid':child.pid,'data':str(data),'private':str(private),'candidate':str(candidate)}));os.chmod(state,0o600);print(json.dumps({'ok':True,'pid':child.pid,'isolated':True}))
