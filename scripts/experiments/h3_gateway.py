"""Dedicated forced-command H3 transport. No shell, paths, config or PIDs from callers.

Only the production controller holds this key. Workers run unprivileged, retain
the shared fenced GPU authority, and stop if their controller lease expires.
The existing TEST runtime, model files and ordinary Comfy services are untouched.
"""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid

PROTOCOL = 'slr-h3-nsfw-v1'
CHUNK = 512 * 1024
MAX_FILE = 128 * 1024 * 1024
ARTIFACTS = {'result.mp4', 'result.png', 'graph.json', 'actual.json', 'media-probe.json'}
TERMINAL = {'completed', 'failed', 'canceled'}


def digest(file):
    h=hashlib.sha256()
    with Path(file).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
    return h.hexdigest()


def write(file,value):
    temp=file.with_name(file.name+'.'+uuid.uuid4().hex+'.tmp')
    with temp.open('x') as stream:json.dump(value,stream)
    temp.replace(file)


def identifier(value):
    if not isinstance(value,str) or str(uuid.UUID(value))!=value:raise ValueError('Invalid identifier')
    return value


def regular(file):
    return file.is_file() and not file.is_symlink() and file.stat().st_nlink==1


class Gateway:
    def __init__(self,bundle):
        self.bundle=Path(bundle).resolve(strict=True)
        self.config=json.loads((self.bundle/'runtime.json').read_text())
        if self.config.get('environment')!='prod' or self.config.get('workspace')!='h3-nsfw':raise ValueError('Incorrect H3 transport boundary')
        self.jobs=self.bundle/'jobs';self.jobs.mkdir(mode=0o700,exist_ok=True)
        if self.jobs.is_symlink():raise ValueError('Unsafe job root')

    def root(self,value):
        root=self.jobs/identifier(value)
        if root.is_symlink() or not root.is_dir() or root.resolve().parent!=self.jobs:raise ValueError('Unknown job')
        return root

    def validate(self,root,raw):
        if not isinstance(raw,dict) or set(raw)!={'id','model','settings','sources'} or raw['id']!=root.name:raise ValueError('Invalid H3 request')
        model=self.config['models'].get(raw['model'])
        if not model:raise ValueError('Unavailable checkpoint')
        s=raw['settings'];allowed={'mode','resolution','orientation','gpu','recipe','seconds','seed','prompt','seedLocked','selectedSources'}
        if not isinstance(s,dict) or set(s)-allowed:raise ValueError('Unsupported H3 settings')
        enums={'mode':model.get('qualifiedModes',[]),'resolution':['0.2','0.6','1'],'orientation':['landscape','portrait'],'gpu':['auto','rtx3090'],'recipe':['author']}
        for key,values in enums.items():
            if s.get(key) not in values:raise ValueError('Unqualified H3 setting')
        if type(s.get('seconds')) is not int or not 2<=s['seconds']<=15 or type(s.get('seed')) is not int or not 0<=s['seed']<=9007199254740991:raise ValueError('Invalid duration or seed')
        if not isinstance(s.get('prompt'),str) or not 0<len(s['prompt'].strip())<=8000 or '\x00' in s['prompt']:raise ValueError('Invalid prompt')
        sources=raw['sources']
        if not isinstance(sources,list) or len(sources)>12:raise ValueError('Invalid references')
        for i,source in enumerate(sources):
            if not isinstance(source,dict) or set(source)-{'name','sha256','kind','assetId'} or source.get('name')!=f'{i}.media' or source.get('kind') not in ['image','video','audio']:raise ValueError('Invalid reference')
            file=root/'sources'/source['name']
            if not regular(file) or not 0<file.stat().st_size<=MAX_FILE or digest(file)!=source.get('sha256'):raise ValueError('Reference checksum mismatch')
        kinds=[s['kind'] for s in sources];mode=s['mode']
        if (mode=='text' and sources) or (mode in ['image','edit-image'] and kinds!=['image']) or (mode=='reference' and not kinds) or (mode=='edit' and (kinds.count('video')!=1 or 'audio' in kinds)) or kinds.count('image')>9 or kinds.count('video')>3 or kinds.count('audio')>3:raise ValueError('Invalid references for this mode')
        return dict(raw,remoteLeaseSeconds=60)

    def handle(self,p):
        shapes={'probe':set(),'create':{'id'},'upload':{'id','name','offset','data'},'start':{'id','request'},'status':{'id'},'cancel':{'id'},'artifacts':{'id'},'download':{'id','name','offset'}}
        if not isinstance(p,dict) or p.get('action') not in shapes or set(p)!={'action'}|shapes[p['action']]:raise ValueError('Unsupported H3 protocol action')
        action=p['action']
        if action=='probe':return {'protocol':PROTOCOL,'restricted':True,'gpu':'rtx3090','runtimeSha256':digest(self.bundle/'runtime.json')}
        if action=='create':
            root=self.jobs/identifier(p['id']);root.mkdir(mode=0o700,exist_ok=True);root=self.root(p['id'])
            if len(list(self.jobs.iterdir()))>500 or shutil.disk_usage(root).free<12*1024**3:raise ValueError('Private worker storage reserve reached')
            (root/'sources').mkdir(mode=0o700,exist_ok=True)
            return {'id':root.name}
        root=self.root(p['id'])
        if action in ['upload','start']:
            with (root/'protocol.lock').open('a') as lock:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                if (root/'request.json').exists() or (root/'cancel').exists():raise ValueError('Job is already sealed or canceled')
                if action=='upload':
                    if not isinstance(p['name'],str) or not re.fullmatch(r'(?:[0-9]|1[01])\.media',p['name']):raise ValueError('Unsupported reference filename')
                    file=root/'sources'/p['name'];offset=p['offset']
                    if file.is_symlink() or (file.exists() and not regular(file)) or type(offset) is not int or offset<0 or offset!=(file.stat().st_size if file.exists() else 0):raise ValueError('Unexpected upload offset')
                    data=base64.b64decode(p['data'],validate=True)
                    if not 0<len(data)<=CHUNK or offset+len(data)>MAX_FILE or shutil.disk_usage(root).free<len(data)+12*1024**3:raise ValueError('Reference exceeds safety limit')
                    fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_APPEND|os.O_NOFOLLOW,0o600)
                    with os.fdopen(fd,'ab') as stream:stream.write(data)
                    return {'bytes':offset+len(data)}
                request=self.validate(root,p['request'])
                for file in self.config['files']:
                    if digest(file['path'])!=file['sha256']:raise ValueError('Qualified worker changed')
                if os.getuid()==0:raise ValueError('GPU inference must not run as root')
                (root/'transport-heartbeat').touch(mode=0o600)
                write(root/'request.json',request)
                with (root/'runner.log').open('x') as log:
                    child=subprocess.Popen(['/usr/bin/python3',str(self.bundle/'h3_runner.py'),'--job',str(root),'--config',str(self.bundle/'runtime.json')],
                        env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':str(Path.home()),'LANG':'C.UTF-8','OTG_ENV':'prod','PYTHONDONTWRITEBYTECODE':'1'},stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
                write(root/'runner-process.json',{'pid':child.pid,'created':time.time()})
                return {'accepted':True}
        if action=='cancel':
            (root/'cancel').touch(mode=0o600)
            if not (root/'request.json').exists():write(root/'status.json',{'id':root.name,'state':'canceled','stage':'Canceled before submission','cleanedUp':True})
            return {'cancelRequested':True}
        file=root/'status.json'
        status=json.loads(file.read_text()) if regular(file) else {'id':root.name,'state':'queued','stage':'Waiting for isolated H3 worker','created':time.time(),'cleanedUp':False}
        if action=='status':
            (root/'transport-heartbeat').touch(mode=0o600)
            return {'status':status}
        if status.get('state')!='completed' or not status.get('cleanedUp'):raise ValueError('No completed output')
        if action=='artifacts':
            files={}
            for name in sorted(ARTIFACTS):
                file=root/name
                if regular(file):
                    if file.stat().st_size>MAX_FILE:raise ValueError('Output exceeds private media limit')
                    files[name]={'bytes':file.stat().st_size,'sha256':digest(file)}
            return {'files':files}
        if p['name'] not in ARTIFACTS:raise ValueError('Unknown artifact')
        file=root/p['name'];offset=p['offset']
        if not regular(file) or type(offset) is not int or not 0<=offset<=file.stat().st_size:raise ValueError('Invalid artifact offset')
        with file.open('rb') as stream:stream.seek(offset);data=stream.read(CHUNK)
        return {'data':base64.b64encode(data).decode(),'bytes':len(data)}


def main():
    os.umask(0o077)
    if os.environ.get('SSH_ORIGINAL_COMMAND')!=PROTOCOL:raise ValueError('Restricted H3 protocol required')
    gateway=Gateway(Path(__file__).parent)
    while True:
        line=sys.stdin.buffer.readline(1024*1024+1)
        if not line:break
        if len(line)>1024*1024 or not line.endswith(b'\n'):raise ValueError('Protocol packet exceeds limit')
        try:response={'ok':True,**gateway.handle(json.loads(line))}
        except Exception as error:response={'ok':False,'error':str(error)[:240]}
        print(json.dumps(response),flush=True)


if __name__=='__main__':main()
