"""Durable production controller for the pinned, restricted 3090 H3 transport.

Rechecks local user grants every poll. Cancellation/revocation is forwarded to
the exact remote job. Lost transport never releases another process's grant or
resubmits a prompt; the remote worker also enforces a 60-second controller lease.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import select
import signal
import sqlite3
import subprocess
import time
import uuid
from h3_gateway import PROTOCOL, CHUNK, MAX_FILE, ARTIFACTS, digest, identifier, regular, write


class Client:
    def __init__(self,cfg,log):
        target=cfg['transport']
        if target['host']!='shawn-rochford@100.75.162.64' or target['protocol']!=PROTOCOL:raise ValueError('Invalid H3 connection')
        args=['/usr/bin/ssh','-F','/dev/null','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8',
              '-o','ServerAliveInterval=10','-o','ServerAliveCountMax=2','-o','UserKnownHostsFile='+target['knownHostsFile'],'-i',target['identityFile'],target['host'],PROTOCOL]
        self.process=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log)
        probe=self.call({'action':'probe'})
        if not probe.get('restricted') or probe.get('gpu')!='rtx3090' or probe.get('runtimeSha256')!=target['runtimeSha256']:self.close();raise ValueError('Remote H3 runtime failed integrity check')

    def call(self,packet):
        self.process.stdin.write(json.dumps(packet).encode()+b'\n');self.process.stdin.flush()
        # One response per packet; no background writer or buffered read-ahead.
        chunks=[];length=0;deadline=time.monotonic()+45
        while True:
            remaining=deadline-time.monotonic()
            if remaining<=0 or not select.select([self.process.stdout],[],[],remaining)[0]:raise TimeoutError('Restricted H3 transport timeout')
            part=os.read(self.process.stdout.fileno(),65536)
            if not part:raise RuntimeError('Restricted H3 connection closed')
            chunks.append(part);length+=len(part)
            if length>1024*1024:raise ValueError('H3 response exceeds limit')
            if part.endswith(b'\n'):break
        response=json.loads(b''.join(chunks))
        if response.get('ok') is not True:raise ValueError(response.get('error','H3 transport refused request'))
        return response

    def close(self):
        if self.process.stdin:self.process.stdin.close()
        try:self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:self.process.terminate();self.process.wait(timeout=5)
        if self.process.stdout:self.process.stdout.close()


def authorized(root,request):
    if (root/'cancel').exists():return False
    grant=request.get('authorization')
    if grant is None:return True
    try:
        identifier(grant['userId'])
        with sqlite3.connect((root.parent.parent/'experiments.sqlite').as_uri()+'?mode=ro',uri=True,timeout=2) as db:
            row=db.execute('SELECT enabled,version FROM h3_nsfw_access WHERE user_id=?',(grant['userId'],)).fetchone()
        return bool(row and row[0]==1 and row[1]==grant['version'])
    except Exception:return False


def execute(root,cfg):
    request=json.loads((root/'request.json').read_text());identifier(request['id'])
    if root.name!=request['id'] or root.parent.name!='jobs' or root.is_symlink():raise ValueError('Invalid private job boundary')
    status=json.loads((root/'status.json').read_text());status.update(cleanedUp=False,heartbeat=time.time())
    client=None;created=False;remote=None;canceled=False
    def update(**kwargs):status.update(kwargs,heartbeat=time.time());write(root/'status.json',status)
    def cancel_signal(*_):
        nonlocal canceled
        canceled=True
    for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,cancel_signal)
    with (root/'transport.log').open('a') as log:
        try:
            if not authorized(root,request):update(state='canceled',stage='Canceled before submission',cleanedUp=True);return
            client=Client(cfg,log);client.call({'action':'create','id':root.name});created=True
            update(stage='Preparing private 3090 references')
            for source in request['sources']:
                file=root/'sources'/source['name']
                if file.resolve().parent!=(root/'sources').resolve() or not regular(file) or not 0<file.stat().st_size<=MAX_FILE or digest(file)!=source['sha256']:raise ValueError('Reference integrity check failed')
                with file.open('rb') as stream:
                    offset=0
                    while True:
                        if canceled or not authorized(root,request):raise InterruptedError('Access changed or job canceled')
                        block=stream.read(CHUNK)
                        if not block:break
                        receipt=client.call({'action':'upload','id':root.name,'name':source['name'],'offset':offset,'data':base64.b64encode(block).decode()})
                        offset+=len(block)
                        if receipt['bytes']!=offset:raise ValueError('Reference transfer receipt mismatch')
                        update(stage='Transferring private 3090 references')
            if canceled or not authorized(root,request):raise InterruptedError('Access changed or job canceled')
            payload={key:request[key] for key in ['id','model','settings','sources']}
            write(root/'remote-execution.json',{'id':root.name,'submissionAttempted':True,'created':time.time()})
            client.call({'action':'start','id':root.name,'request':payload})
            deadline=time.monotonic()+26*3600
            while True:
                if canceled or not authorized(root,request):
                    client.call({'action':'cancel','id':root.name});canceled=True
                remote=client.call({'action':'status','id':root.name})['status']
                terminal=remote.get('state') in ['completed','failed','canceled'] and remote.get('cleanedUp') is True
                update(**{k:v for k,v in remote.items() if k not in ['id','state','cleanedUp','heartbeat']},state='running' if terminal and remote['state']=='completed' else remote['state'],cleanedUp=False)
                if terminal:break
                if time.monotonic()>deadline:raise TimeoutError('Private H3 run exceeded safety limit')
                time.sleep(3)
            if remote['state']=='completed':
                update(stage='Verifying private 3090 output transfer')
                files=client.call({'action':'artifacts','id':root.name})['files']
                result='result.png' if request['settings']['mode']=='edit-image' else 'result.mp4'
                if result not in files or files[result]['sha256']!=remote.get('outputSha256') or files[result]['bytes']!=remote.get('outputBytes'):raise ValueError('Output receipt mismatch')
                for name,receipt in files.items():
                    if name not in ARTIFACTS or type(receipt['bytes']) is not int or not 0<receipt['bytes']<=MAX_FILE:raise ValueError('Invalid artifact receipt')
                    file=root/(name+'.transferring');offset=0
                    with file.open('xb') as stream:
                        while offset<receipt['bytes']:
                            block=client.call({'action':'download','id':root.name,'name':name,'offset':offset})
                            data=base64.b64decode(block['data'],validate=True)
                            if not 0<len(data)<=CHUNK or len(data)!=block['bytes'] or offset+len(data)>receipt['bytes']:raise ValueError('Invalid download chunk')
                            stream.write(data);offset+=len(data);update(stage='Transferring verified private output')
                    if digest(file)!=receipt['sha256']:raise ValueError('Output checksum mismatch')
                    file.replace(root/name)
            update(**{k:v for k,v in remote.items() if k not in ['id','heartbeat']})
        except Exception as error:
            acknowledged=not created or bool(remote and remote.get('cleanedUp'))
            if created and not acknowledged:
                # Cancellation only. Never retry start or force-release a GPU reservation.
                if client:
                    try:client.close()
                    except Exception:pass
                try:
                    client=Client(cfg,log);client.call({'action':'cancel','id':root.name})
                    deadline=time.monotonic()+100
                    while time.monotonic()<deadline:
                        remote=client.call({'action':'status','id':root.name})['status']
                        if remote.get('cleanedUp'):acknowledged=True;break
                        update(stage='Stopping only the owned remote H3 job');time.sleep(3)
                except Exception:pass
            update(state=('canceled' if isinstance(error,InterruptedError) or canceled else 'failed') if acknowledged else 'needs_attention',
                   stage=str(error)[:600] if acknowledged else 'Remote H3 cleanup is unconfirmed. No resubmission or reservation release was attempted; administrator recovery required.',cleanedUp=acknowledged,completed=time.time())
        finally:
            if client:
                try:client.close()
                except Exception:pass


def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser();parser.add_argument('--job',required=True);parser.add_argument('--config',required=True);args=parser.parse_args()
    cfg=json.loads(Path(args.config).read_text())
    if os.environ.get('OTG_ENV')!='prod' or cfg.get('environment')!='prod' or cfg.get('workspace')!='h3-nsfw':raise ValueError('Invalid production controller boundary')
    execute(Path(args.job).absolute(),cfg)


if __name__=='__main__':main()
