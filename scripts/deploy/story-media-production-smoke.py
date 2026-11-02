"""Start/stop only an isolated candidate process on the production host."""
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time


def main():
    os.umask(0o077)
    stage=Path(sys.argv[1]).resolve(strict=True);action=sys.argv[2]
    if os.geteuid()!=0 or socket.gethostname()!='slr' or stage.parent!=Path('/mnt/otg_bulk') or not stage.name.startswith('build-2.21-promotion-'):raise RuntimeError('Incorrect smoke boundary')
    plan=json.loads((stage/'activation-plan.json').read_text());candidate=Path(plan['candidate']);file=stage/'smoke-process.json'
    if action=='start':
        if file.exists():
            previous=json.loads(file.read_text())
            if not previous.get('stopped'):raise RuntimeError('Smoke process already recorded')
            file.rename(stage/('smoke-process-previous-'+str(previous['pid'])+'.json'))
        with socket.socket() as s:s.bind(('127.0.0.1',3308))
        data=Path(tempfile.mkdtemp(prefix='smoke-data-',dir=stage))
        pid=subprocess.check_output(['systemctl','show','otg-prod.service','-p','MainPID','--value'],text=True).strip()
        live=dict(item.split('=',1) for item in Path('/proc/'+pid+'/environ').read_text().split('\0') if '=' in item)
        env={key:value for key,value in live.items() if key in ('PATH','HOME','LANG','OTG_MEDIA_GPU_ROUTING','OTG_MEDIA_ADMISSION_CONFIG','OTG_MEDIA_3090_IMAGE_URL','OTG_MEDIA_3090_H3_URL','OTG_MEDIA_5060_URL','COMFYUI_IMAGE_URL','COMFYUI_VIDEO_URL','STORY_CREATOR_CPU_ROOT','OTG_SHAWN_PROCESS_PROBE_TARGET','OTG_SHAWN_PROCESS_PROBE_IDENTITY_FILE','OTG_SHAWN_PROCESS_PROBE_SSH_CONFIG')}
        env.update(NODE_ENV='production',OTG_ENV='prod',PORT='3308',HOSTNAME='127.0.0.1',AUTH_SECRET=secrets.token_hex(48),AUTH_COOKIE_NAME='story_promotion_smoke',OTG_STORY_MEDIA_ENABLED='1',OTG_PRIVATE_RESEARCH_MEDIA='1',
            OTG_STORY_QWEN_REMOTE_CONFIG=plan['speechConfig'],OTG_DATA_DIR=str(data),OTG_DATA_ROOT=str(data),OTG_PERSISTENT_DATA_ROOT=str(data),OTG_DEVICE_OUTPUT_ROOT=str(data/'devices'),OTG_WORKER_CONTROL_STORE_DIR=str(data/'worker-control'),OTG_MEDIA_GPU_QUEUE_DB=str(data/'media-gpu-queue/queue.sqlite'),
            OTG_RUNTIME_ROOT=str(stage/'smoke-runtime'),OTG_CONFIG_ROOT=str(stage/'smoke-config'),OTG_AUDIO_EDITING_ENABLED='0',OPENAI_API_KEY='local-director-fixture',OPENAI_BASE_URL='http://100.75.162.64:3391/v1',OPENAI_KILL_SWITCH='0',NEXT_TELEMETRY_DISABLED='1')
        with (stage/('smoke-server-'+data.name+'.log')).open('xb') as log:
            process=subprocess.Popen(['/opt/otg/runtime/node-v22.23.4/bin/node',str(candidate/'server.js')],cwd=candidate,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
        file.write_text(json.dumps({'pid':process.pid,'candidate':str(candidate),'data':str(data)}));print(json.dumps({'ok':True,'pid':process.pid,'port':3308,'managedProductionChanged':False}))
    elif action=='stop':
        state=json.loads(file.read_text());pid=state['pid'];data=Path(state['data']);queue=data/'media-gpu-queue/queue.sqlite'
        for attempt in range(30):
            busy=False
            if queue.exists():
                with sqlite3.connect(queue.resolve().as_uri()+'?mode=ro',uri=True) as db:busy=bool(db.execute("SELECT 1 FROM media_jobs WHERE status NOT IN ('completed','failed','canceled') OR admissionToken IS NOT NULL LIMIT 1").fetchone())
            if not busy:break
            time.sleep(1)
        if busy:raise RuntimeError('Owned smoke work or its reservation is unfinished; process retained')
        if Path('/proc/'+str(pid)+'/cwd').resolve()!=candidate.resolve():raise RuntimeError('Smoke process identity changed')
        os.kill(pid,signal.SIGTERM);state['stopped']=True;file.write_text(json.dumps(state));print(json.dumps({'ok':True,'stoppedPid':pid,'managedProductionChanged':False}))
    else:raise RuntimeError('Choose start or stop')


if __name__=='__main__':main()
