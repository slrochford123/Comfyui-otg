"""Qwen adapter for the existing restricted audio gateway, run unprivileged."""
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import wave


def main():
    os.umask(0o077)
    request = Path(sys.argv[1]).resolve(strict=True)
    root, job = request.parent, json.loads(request.read_text())
    config = json.loads(Path(os.environ['OTG_AUDIO_ENGINE_CONFIG']).read_text())
    if os.getuid() == 0 or job['operation'] != 'speech' or job['gpu'] != 'rtx3090':
        raise ValueError('Qwen requires the unprivileged RTX 3090 worker')
    parent, child = os.getppid(), None
    (root/'worker.pid').write_text(str(os.getpid()))

    def status(state, message):
        temporary = root/'status.tmp'
        temporary.write_text(json.dumps({'id':job['id'],'status':state,'stage':message,'progress':100 if state=='completed' else 10}))
        temporary.replace(root/'status.json')

    def stop(_signum=None, _frame=None):
        raise InterruptedError('Speech canceled')

    def check():
        heartbeat = root/'transport-heartbeat'
        if (root/'cancel').exists() or os.getppid()!=parent or time.time()-heartbeat.stat().st_mtime>60:
            raise InterruptedError('Speech canceled or its transport disconnected')

    for number in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(number,stop)
    try:
        status('running','Waiting for the speech GPU')
        with Path(config['voiceLock']).open('a') as lock:
            while True:
                check()
                try:
                    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    time.sleep(.25)
            devices=subprocess.check_output(['/usr/bin/nvidia-smi','--query-gpu=uuid,name','--format=csv,noheader'],text=True,timeout=5)
            gpu=next((line.split(',')[0].strip() for line in devices.splitlines() if 'RTX 3090' in line),'')
            if not gpu:
                raise ValueError('Qualified RTX 3090 unavailable')
            output=root/'speech.wav'
            params=job['params']
            payload={'parent_pid':os.getpid(),'model':config['base' if job.get('source') else 'design'],
                'output':str(output),'text':params['text'],'instruction':params['instruction'],
                'reference':job.get('source') or '', 'reference_text':params.get('description','')}
            if 'seed' in params:
                payload['seed']=params['seed']
            check()
            status('running','Creating Qwen speech')
            child=subprocess.Popen([config['qwenPython'],str(Path(__file__).with_name('qwen_media.py'))],stdin=subprocess.PIPE,
                env={**os.environ,'CUDA_VISIBLE_DEVICES':gpu,'TOKENIZERS_PARALLELISM':'false'})
            child.stdin.write(json.dumps(payload).encode());child.stdin.close()
            deadline=time.monotonic()+900
            while child.poll() is None:
                check()
                if time.monotonic()>deadline:
                    raise InterruptedError('Speech exceeded its time limit')
                time.sleep(.25)
            if child.returncode:
                raise RuntimeError('Qwen inference failed; see the private worker log')
            check()
            with wave.open(str(output),'rb') as audio:
                rate,channels,frames=audio.getframerate(),audio.getnchannels(),audio.getnframes()
            if frames<rate//5:
                raise ValueError('Empty speech result')
            (root/'result.json').write_text(json.dumps({'assets':[{'file':str(output),'kind':'audio','name':'Qwen3 speech','duration':frames/rate,'sampleRate':rate,'channels':channels,'engine':'qwen3'}]}))
        status('completed','Speech complete')
    except BaseException as error:
        if child is not None and child.poll() is None:
            child.terminate()
            try:child.wait(timeout=5)
            except subprocess.TimeoutExpired:child.kill();child.wait(timeout=5)
        status('canceled' if isinstance(error,InterruptedError) else 'failed',str(error))
        return 1
    return 0


if __name__=='__main__':
    sys.exit(main())
