#!/usr/bin/python3
"""Testing-tab runner; inherits fenced admission/cleanup, not Admin model mappings."""
import argparse
import os
import shutil
from pathlib import Path
import time
from h3_runner import Job, Cancelled, read, sha
from testing_graph import compile_graph, profile
from director_runtime import execute_director


class TestingJob(Job):
    def validate_model(self, model, settings):
        if settings.get('gpu') not in ('auto','rtx3090'):
            raise ValueError('Only the privately qualified 3090 is enabled')
        if model=='director-studio':
            if settings.get('mode')!='text' or self.request.get('sources'):
                raise ValueError('Director planning accepts text, not unverified media analysis')
            if not isinstance(settings.get('prompt'),str) or not settings['prompt'].strip() or len(settings['prompt'])>8000 or type(settings.get('seed')) is not int or not 0<=settings['seed']<=9007199254740991:
                raise ValueError('Invalid Director concept or seed')
            cfg=self.cfg['director']
            for asset in [cfg['manifest'],*cfg['blobs']]:
                st=Path(asset['path']).stat()
                if st.st_size!=asset['bytes'] or st.st_mtime_ns!=asset['mtimeNs']:raise ValueError('Pinned Director model changed')
            if sha(cfg['binary'])!=cfg['binarySha256']:raise ValueError('Pinned Ollama runtime changed')
            return Path(cfg['manifest']['path'])
        self.family, self.variant = profile(model, settings)
        self.required = ['base-denomix','deno-acc','deno-dmd','deno-refiner','deno-lifter'] if model=='sol-denomix' else ['base-'+self.family, self.variant+'-'+self.family]
        if model=='cinematic-upscale':self.required.append('realesrgan-x2')
        for key in self.required:
            asset = self.cfg['assets'][key]; file = Path(asset['path']); stat = file.stat()
            if stat.st_size != asset['bytes'] or stat.st_mtime_ns != asset['mtimeNs']:
                raise ValueError('Pinned Testing asset changed; checksum qualification required: '+key)
        return Path(self.cfg['assets']['base-'+self.family]['path'])
    def run_worker(self, checkpoint, model, settings):
        if model=='director-studio':return execute_director(self)
        return super().run_worker(checkpoint,model,settings)
    def checkpoint_hash(self, model):
        return self.cfg['assets']['base-'+self.family]['sha256']
    def prepare_extra_models(self, worker):
        target = worker/'models/loras'; target.mkdir(mode=0o700)
        keys = ['deno-acc','deno-dmd','deno-refiner'] if self.family=='denomix' else [self.variant+'-'+self.family]
        for key in keys:(target/(key+'.safetensors')).symlink_to(self.cfg['assets'][key]['path'])
        if self.request['model']=='cinematic-upscale':
            target=worker/'models/upscale_models';target.mkdir(mode=0o700)
            (target/'lab-realesrgan-x2.pth').symlink_to(self.cfg['assets']['realesrgan-x2']['path'])
        if self.family=='denomix':
            target=worker/'models/latent_upscale_models';target.mkdir(mode=0o700)
            (target/'deno-lifter.safetensors').symlink_to(self.cfg['assets']['deno-lifter']['path'])
        if self.variant == 'base8' or self.family=='denomix':
            name='LabLatent' if self.family=='denomix' else 'LabSLA'
            source = Path(self.cfg['privateNodes'])/name
            for file in self.cfg['nodeFiles']:
                if sha(Path(self.cfg['privateNodes'])/file['name']) != file['sha256']:
                    raise ValueError('Private node checksum changed')
            shutil.copytree(source,worker/'custom_nodes'/name,ignore=shutil.ignore_patterns('__pycache__','tests'))
    def custom_nodes(self):
        return ['LabMemory','LabLatent'] if self.family=='denomix' else ['LabMemory','LabSLA'] if self.variant == 'base8' else ['LabMemory']
    def build_graph(self, model, settings, sources, encoder):
        graph, actual = compile_graph(model, settings, sources, encoder)
        actual['assets'] = {key:{k:self.cfg['assets'][key][k] for k in ('sha256','bytes')} for key in self.required}
        return graph, actual


def main():
    os.umask(0o077)
    p=argparse.ArgumentParser();p.add_argument('--job',required=True);p.add_argument('--config',required=True);a=p.parse_args()
    cfg=read(a.config)
    if os.environ.get('OTG_ENV')!='test' or cfg.get('environment')!='test' or cfg.get('gpu')!='rtx3090':
        raise ValueError('TEST-only private runtime')
    job=TestingJob(Path(a.job).absolute(),cfg)
    try:job.execute()
    except Cancelled as error:job.update(state='canceled',stage=str(error),completed=time.time())
    except Exception as error:job.update(state='failed',stage=str(error)[:800],completed=time.time());raise
    finally:
        try:job.cleanup()
        except Exception:
            job.update(state='needs_attention',stage='Private cleanup/reservation release unconfirmed; no automatic retry.',cleanedUp=False)
            raise


if __name__=='__main__':main()
