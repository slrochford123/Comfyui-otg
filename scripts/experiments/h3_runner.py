#!/usr/bin/python3
"""One durable private job, one fresh loopback-only ComfyUI process.

Shares the established physical GPU authority with the normal application.
Never talks to a production mutation endpoint. No cache eviction, resets,
service changes, package installs, or modifications to the shared model tree.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import uuid
from h3_graph import HASHES, compile_graph


def read(path): return json.loads(Path(path).read_text())
def write(path, value):
    path = Path(path); temp = path.with_suffix('.writing')
    temp.write_text(json.dumps(value, indent=2)); os.chmod(temp, 0o600); temp.replace(path)
def run(args, **kw):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=kw.pop('timeout', 20), **kw).stdout
def http(base, route, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(base + route, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=10) as response: return json.load(response)
def sha(file):
    with open(file, 'rb') as stream: return hashlib.file_digest(stream, 'sha256').hexdigest()
def probe(file):
    return json.loads(run(['/usr/bin/ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe',
        '-show_streams', '-show_format', '-of', 'json', str(file)]))


class Cancelled(Exception): pass


class Job:
    def __init__(self, root, config):
        self.root, self.cfg = root, config
        self.request = read(root/'request.json'); self.id = str(uuid.UUID(self.request['id']))
        if root.name != self.id or root.is_symlink(): raise ValueError('Invalid private job directory')
        self.child = None; self.token = None; self.cancelled = False
        self.status = dict(id=self.id, state='queued', stage='Waiting for the private GPU lane', created=time.time())
        for sig in (signal.SIGTERM, signal.SIGINT): signal.signal(sig, self.signal)
    def signal(self, *_): self.cancelled = True
    def check_cancel(self):
        if self.cancelled or (self.root/'cancel').exists(): raise Cancelled('Canceled by administrator')
        if getattr(self, 'request', {}).get('remoteLeaseSeconds') == 60:
            lease = self.root/'transport-heartbeat'
            if not lease.is_file() or lease.is_symlink() or time.time()-lease.stat().st_mtime > 60:
                raise Cancelled('Production controller disconnected; private job stopped safely')
        authorization = getattr(self, 'request', {}).get('authorization')
        if authorization is not None:
            import sqlite3
            from contextlib import closing
            # Fixed private database adjacent to jobs/, never a client path.
            if self.root.parent.name != 'jobs': raise Cancelled('Invalid access-check boundary')
            try:
                user = str(uuid.UUID(authorization['userId']))
                with closing(sqlite3.connect('file:'+str(self.root.parent.parent/'experiments.sqlite')+'?mode=ro', uri=True, timeout=2)) as db:
                    row = db.execute('SELECT enabled,version FROM h3_nsfw_access WHERE user_id=?',(user,)).fetchone()
                if not row or row[0] != 1 or row[1] != authorization['version']:
                    raise Cancelled('H3 NSFW access changed or was revoked; private job canceled')
            except Cancelled: raise
            except Exception as error: raise Cancelled('H3 NSFW permission could not be verified; private job canceled') from error
    def update(self, **kwargs):
        self.status.update(kwargs, heartbeat=time.time()); write(self.root/'status.json', self.status)
    def admission(self, action):
        cfg = self.cfg['admission']
        if cfg['mode'] != 'ssh': raise ValueError('Reviewed shared SSH authority is required')
        args = ['/usr/bin/ssh', *cfg.get('sshOptions', []), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5',
                '-o', 'ClearAllForwardings=yes', '--', cfg['target'], '/usr/bin/python3 ' + cfg['script']]
        result = json.loads(run(args, input=json.dumps(dict(action=action, gpu='rtx3090', owner=self.id,
            **({'token': self.token} if action == 'release' else {}))) + '\n', timeout=20))
        if result.get('ok') is not True: raise RuntimeError('Shared GPU authority unavailable')
        return result
    def idle(self):
        for base in self.cfg['queues']:
            q = http(base, '/queue')
            if q.get('queue_running') or q.get('queue_pending'): return False
        mem = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
        if int(mem['MemAvailable'].split()[0]) < self.cfg.get('minRamGiB', 34) * 1024**2: return False
        gpu = run(['nvidia-smi', '-i', self.cfg['gpuUuid'], '--query-gpu=memory.free,utilization.gpu', '--format=csv,noheader,nounits']).strip().split(',')
        return int(gpu[0]) >= self.cfg.get('minVramMiB', 20000) and int(gpu[1]) < 5
    def source_files(self, worker):
        sources = []
        for index, asset in enumerate(self.request.get('sources', [])):
            self.check_cancel()
            file = self.root/'sources'/asset['name']
            if file.resolve().parent != (self.root/'sources').resolve() or file.is_symlink() or sha(file) != asset['sha256']:
                raise ValueError('Reference integrity check failed')
            kind = asset['kind']; info = probe(file); has_audio = any(s['codec_type'] == 'audio' for s in info['streams'])
            extension = {'image':'.png','video':'.mp4','audio':'.wav'}[kind]
            name = str(index) + extension; target = worker/'input'/name
            args = ['/usr/bin/ffmpeg','-nostdin','-v','error','-i',str(file)]
            if kind == 'image': args += ['-frames:v','1','-vf',"scale=w='min(1344,iw)':h='min(1344,ih)':force_original_aspect_ratio=decrease",'-threads','2']
            elif kind == 'video': args += ['-t',str(self.request['settings']['seconds']),'-vf',"fps=24,scale=w='min(608,iw)':h='min(608,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",'-c:v','libx264','-preset','fast','-crf','18','-threads','2','-c:a','aac']
            else: args += ['-t','15','-c:a','pcm_s16le']
            run(args + [str(target)], timeout=120)
            sources.append(dict(kind=kind, name=name, hasAudio=has_audio))
        return sources
    def validate_model(self, model, settings):
        if model not in HASHES or model not in self.cfg['models']: raise ValueError('Exact checkpoint is not installed')
        if settings['gpu'] not in ('auto', 'rtx3090'): raise ValueError('This isolated runner is qualified for the 3090 only')
        model_info = self.cfg['models'][model]; file = Path(model_info['path'])
        if model_info['sha256'] != HASHES[model] or file.stat().st_size != model_info['bytes'] or file.stat().st_mtime_ns != model_info['mtimeNs']:
            raise ValueError('Pinned checkpoint changed; checksum qualification required')
        return file
    def build_graph(self, model, settings, sources, encoder):
        loras=[dict(filename=f'lab-{i}.safetensors',strength=s['strength'],id=s['id']) for i,s in enumerate(settings.get('loras',[]))]
        return compile_graph(model, settings, sources, encoder, loras)
    def prepare_extra_models(self, worker):
        model=self.request['model']; selections=self.request['settings'].get('loras',[])
        if len(selections)>6 or len({s['id'] for s in selections})!=len(selections):raise ValueError('Invalid private LoRA selection')
        for i,selection in enumerate(selections):
            info=self.cfg.get('loras',{}).get(selection['id'])
            if not info or model not in info['models'] or not info['minStrength']<=selection['strength']<=info['maxStrength']:raise ValueError('Unqualified private LoRA/strength')
            source=Path(info['path']); stat=source.stat()
            if not source.resolve().is_relative_to((Path(self.cfg['sharedModels'])/'loras').resolve()) or stat.st_size!=info['bytes'] or stat.st_mtime_ns!=info['mtimeNs'] or sha(source)!=info['sha256']:raise ValueError('Private LoRA pin changed')
            directory=worker/'models/loras';directory.mkdir(exist_ok=True)
            (directory/f'lab-{i}.safetensors').symlink_to(source)
    def custom_nodes(self):
        return ['LabMemory']
    def checkpoint_hash(self, model):
        return HASHES[model]
    def execute(self):
        model = self.request['model']; settings = self.request['settings']
        file = self.validate_model(model, settings)
        # One process per queued request, serialized before entering the global authority.
        with open(self.root.parent/'lane.lock','a') as lock:
            deadline = time.monotonic() + 86400
            while True:
                self.check_cancel()
                if time.monotonic() > deadline: raise RuntimeError('Private queue wait exceeded 24 hours')
                try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB); break
                except BlockingIOError: self.update(stage='Queued behind another private H3 job'); time.sleep(3)
            while True:
                self.check_cancel()
                if time.monotonic() > deadline: raise RuntimeError('Waiting for safe GPU resources exceeded 24 hours')
                if self.idle():
                    grant = self.admission('acquire')
                    if grant.get('granted'):
                        self.token = grant['token']; write(self.root/'reservation.json', dict(gpu='rtx3090',owner=self.id,token=self.token))
                        if self.idle(): break
                        self.admission('release'); self.token = None
                self.update(stage='Waiting for idle 3090, shared reservation and sufficient RAM/VRAM'); time.sleep(5)
            self.run_worker(file, model, settings)
    def run_worker(self, checkpoint, model, settings):
        started = time.time(); self.update(state='running', stage='Preparing private H3 worker', started=started, gpu='rtx3090', progressPercent=2)
        worker = self.root/'worker'
        for name in ('input','output','temp','user','custom_nodes','models/diffusion_models','models/text_encoders','models/vae','cache'):
            (worker/name).mkdir(parents=True, mode=0o700)
        (worker/'models/diffusion_models'/f'{model}.safetensors').symlink_to(checkpoint)
        encoder = self.cfg['encoder']
        for folder, name in [('text_encoders',encoder),('vae','minimax_h3_video_vae_fp16.safetensors'),('vae','minimax_h3_audio_vae_fp32.safetensors')]:
            (worker/'models'/folder/name).symlink_to(Path(self.cfg['sharedModels'])/folder/name)
        shutil.copytree(Path(__file__).parent/'LabMemory', worker/'custom_nodes/LabMemory', ignore=shutil.ignore_patterns('__pycache__'))
        self.prepare_extra_models(worker)
        sources = self.source_files(worker)
        graph, actual = self.build_graph(model, settings, sources, encoder)
        write(self.root/'graph.json', graph); write(self.root/'actual.json', actual)
        self.update(actual=actual, model=model, checkpointSha256=self.checkpoint_hash(model), seed=settings['seed'])
        with socket.socket() as sock: sock.bind(('127.0.0.1',0)); port = sock.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        env = {key: os.environ[key] for key in ('PATH','HOME','LANG') if key in os.environ}
        env.update(CUDA_VISIBLE_DEVICES=self.cfg['gpuUuid'], PYTHONDONTWRITEBYTECODE='1', HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
                   XDG_CACHE_HOME=str(worker/'cache'), TRITON_CACHE_DIR=str(worker/'cache/triton'), CUDA_CACHE_PATH=str(worker/'cache/cuda'), TORCHINDUCTOR_CACHE_DIR=str(worker/'cache/inductor'))
        args = [self.cfg['python'], str(Path(self.cfg['comfy'])/'main.py'), '--listen','127.0.0.1','--port',str(port),
                '--base-directory',str(worker),'--user-directory',str(worker/'user'),'--database-url','sqlite:///:memory:',
                '--reserve-vram','2','--disable-pinned-memory','--use-pytorch-cross-attention','--enable-dynamic-vram',
                '--preview-method','none','--cache-none','--offline','--disable-all-custom-nodes','--whitelist-custom-nodes',*self.custom_nodes()]
        with open(self.root/'worker.log','w') as log:
            self.child = subprocess.Popen(args, cwd=self.cfg['comfy'], env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        write(self.root/'worker-process.json',dict(pid=self.child.pid,port=port,created=time.time(),base=str(worker)))
        limit = time.monotonic()+180
        while True:
            self.check_cancel()
            if self.child.poll() is not None: raise RuntimeError('Isolated worker failed to start; inspect private worker.log')
            try: http(base,'/system_stats'); break
            except Exception:
                if time.monotonic()>limit: raise RuntimeError('Private worker startup timeout')
                time.sleep(2)
        submitted=time.time()
        try: result=http(base,'/prompt',{'prompt':graph,'client_id':self.id})
        except urllib.error.HTTPError as error:
            write(self.root/'validation-error.json',json.loads(error.read())); raise RuntimeError('H3 graph validation failed; inspect private validation-error.json') from error
        if not result.get('prompt_id') or result.get('node_errors'): raise RuntimeError('H3 graph rejected')
        prompt=result['prompt_id']; self.update(stage='H3 encoding / sampling / AV decoding', promptId=prompt, submitted=submitted)
        deadline=time.monotonic()+7200; peak=0; checked=0
        preview_version=0
        while True:
            self.check_cancel()
            if self.child.poll() is not None: raise RuntimeError('Private worker exited before completing the graph')
            if time.monotonic()>deadline: raise RuntimeError('Private generation exceeded two-hour safety limit')
            history=http(base,'/history/'+prompt).get(prompt)
            preview_file=self.root/'preview-state.json'
            if preview_file.is_file() and not preview_file.is_symlink():
                preview=read(preview_file)
                if preview.get('updated',0)>preview_version:
                    preview_version=preview['updated']
                    stage='Decoding video/audio and saving result' if preview['step']>=preview['total'] else f"Sampling · step {preview['step']} of {preview['total']}"
                    self.update(stage=stage,progress=preview,previewVersion=preview.get('previewVersion',self.status.get('previewVersion')),progressPercent=min(90,5+round(85*preview['step']/max(1,preview['total']))))
            if history:
                write(self.root/'history.json',history)
                if history.get('status',{}).get('status_str') != 'success':
                    errors=[v for k,v in history.get('status',{}).get('messages',[]) if k=='execution_error']
                    message=errors[-1].get('exception_message','') if errors else ''
                    raise RuntimeError('ComfyUI generation failed: '+message[:600])
                break
            if time.monotonic()-checked > 10:
                checked=time.monotonic()
                mem=int(run(['nvidia-smi','-i',self.cfg['gpuUuid'],'--query-gpu=memory.used','--format=csv,noheader,nounits']).strip()); peak=max(peak,mem)
                for endpoint in self.cfg['queues']:
                    queue=http(endpoint,'/queue')
                    if queue.get('queue_running') or queue.get('queue_pending'): raise RuntimeError('Ordinary GPU work appeared; private job stopped to protect it')
                memory=dict(line.split(':',1) for line in Path('/proc/meminfo').read_text().splitlines())
                if int(memory['MemAvailable'].split()[0]) < 4 * 1024**2:
                    raise RuntimeError('Less than 4 GiB system RAM available; private worker stopped to protect the host')
                self.update(peakGpuMiB=peak,elapsedSeconds=round(time.time()-started,1))
            time.sleep(2)
        raw_completed=time.time()
        if settings['mode']=='edit-image':
            outputs=list((worker/'output').rglob('lab-image*.png'))
            if len(outputs)!=1:raise RuntimeError('Expected exactly one native H3 image, not a video frame selection')
            output=self.root/'result.png';shutil.copyfile(outputs[0],output)
            final=probe(output);v=next(s for s in final['streams'] if s['codec_type']=='video')
            if (int(v['width']),int(v['height']))!=(actual['width'],actual['height']):raise RuntimeError('Image dimensions do not match request')
            write(self.root/'media-probe.json',final)
            self.update(state='completed',stage='Image complete',progressPercent=100,completed=time.time(),rawSeconds=round(raw_completed-submitted,3),
                        totalSeconds=round(time.time()-started,3),outputBytes=output.stat().st_size,outputSha256=sha(output),peakGpuMiB=peak)
            return
        outputs=list((worker/'output').rglob('*.mp4'))
        if len(outputs)!=1: raise RuntimeError('Expected one real H3 video output')
        raw=probe(outputs[0]); video=next(s for s in raw['streams'] if s['codec_type']=='video')
        if int(video.get('nb_frames',0)) < actual['frames']: raise RuntimeError('Native output is shorter than requested; padding is prohibited')
        self.update(stage='Finishing and validating video', progressPercent=95, rawSeconds=round(raw_completed-submitted,3))
        output=self.root/'result.mp4'
        run(['/usr/bin/ffmpeg','-nostdin','-v','error','-i',str(outputs[0]),'-map','0:v:0','-map','0:a:0?',
             '-frames:v',str(actual['frames']),'-t',str(settings['seconds']),'-c:v','libx264','-preset','fast','-crf','18','-threads','2',
             '-c:a','aac','-b:a','192k','-movflags','+faststart',str(output)],timeout=180)
        final=probe(output); v=next(s for s in final['streams'] if s['codec_type']=='video')
        if (int(v['width']),int(v['height']),int(v['nb_frames'])) != (actual['width'],actual['height'],actual['frames']) or v['r_frame_rate']!='24/1':
            raise RuntimeError('Delivered video dimensions/frame count do not match the request')
        if not any(s['codec_type']=='audio' for s in final['streams']): raise RuntimeError('H3 audio output missing')
        write(self.root/'media-probe.json',final)
        self.update(state='completed',stage='Video complete',progressPercent=100,completed=time.time(),totalSeconds=round(time.time()-started,3),
                    outputBytes=output.stat().st_size,outputSha256=sha(output),peakGpuMiB=peak)
    def cleanup(self):
        if self.child and self.child.poll() is None:
            os.killpg(self.child.pid,signal.SIGTERM)
            try:self.child.wait(timeout=20)
            except subprocess.TimeoutExpired:os.killpg(self.child.pid,signal.SIGKILL);self.child.wait(timeout=10)
        if self.token is not None:
            result=self.admission('release')
            if result.get('matched') is not True: raise RuntimeError('GPU reservation release was not confirmed')
            self.token=None
        self.update(cleanedUp=True)


def main():
    os.umask(0o077)
    p=argparse.ArgumentParser();p.add_argument('--job',required=True);p.add_argument('--config',required=True);args=p.parse_args()
    root=Path(args.job).absolute();cfg=read(args.config)
    environment=os.environ.get('OTG_ENV')
    if environment not in ('test','prod') or cfg.get('environment')!=environment or cfg.get('gpu')!='rtx3090': raise ValueError('Invalid isolated runtime boundary')
    if environment=='prod' and (os.getuid()==0 or cfg.get('workspace')!='h3-nsfw' or read(root/'request.json').get('remoteLeaseSeconds')!=60): raise ValueError('Production H3 requires the unprivileged restricted transport')
    job=Job(root,cfg)
    try:job.execute()
    except Cancelled as error:job.update(state='canceled',stage=str(error),completed=time.time())
    except Exception as error:job.update(state='failed',stage=str(error)[:800],completed=time.time());raise
    finally:
        try:job.cleanup()
        except Exception:
            job.update(state='needs_attention',stage='Private worker cleanup or GPU reservation release is unconfirmed. Administrator recovery required; no automatic retry.',cleanedUp=False)
            raise


if __name__=='__main__':main()
