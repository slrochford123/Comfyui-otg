"""Stage Build 2.12 and its guarded TEST activation; never restart services."""
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

SOURCE=Path(__file__).resolve().parents[2]
BASE=Path('/home/shawn-rochford/AI/research/private-audio-channel-20261029-1ude1930')
TEST=Path('/home/shawn-rochford/AI/deploy/otg-test')
PREVIOUS=TEST/'releases/test3001-media-gpu-routing-2.11-20261029T212635Z'


def sha(file):
    value=hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):value.update(block)
    return value.hexdigest()


def adapt_activation(text):
    def change(old,new):
        nonlocal text
        if text.count(old)!=1:raise RuntimeError('Reviewed TEST template changed; inspect before staging')
        text=text.replace(old,new)
    change("UNIT = 'otg-test.service'","UNIT = 'otg-test.service'\nADMISSION = ROOT/'test-admission.json'")
    change('def validate_environment(before, after, routing):','def validate_environment(before, after, routing, admission=str(ADMISSION)):')
    change("    for key in set(before)|set(after):","    if after.get('OTG_MEDIA_ADMISSION_CONFIG') != admission:\n        fail('Shared TEST GPU authority setting mismatch.')\n    for key in set(before)|set(after):")
    change("key != 'OTG_MEDIA_GPU_ROUTING'","key not in ('OTG_MEDIA_GPU_ROUTING','OTG_MEDIA_ADMISSION_CONFIG')")
    change("    return receipt, candidate, previous","    if sha(ADMISSION) != receipt['admissionSha256']: fail('Pinned TEST authority changed.')\n    return receipt, candidate, previous")
    change('def idle():','''def shared_idle():
    cfg=json.loads(ADMISSION.read_text())
    for gpu in ('rtx3090','rtx5060ti'):
        args=['/usr/bin/ssh',*cfg['sshOptions'],'-o','BatchMode=yes','-o','ConnectTimeout=5','--',cfg['target'],'/usr/bin/python3 '+cfg['script']]
        extra={'uid':1000,'gid':1000} if os.geteuid()==0 else {}
        response=subprocess.run(args,input=(json.dumps({'action':'status','gpu':gpu,'owner':'00000000-0000-0000-0000-000000000000'})+'\\n').encode(),capture_output=True,timeout=15,
            env={'PATH':'/usr/bin:/bin','HOME':'/home/shawn-rochford','LANG':'C.UTF-8'},**extra)
        if response.returncode or json.loads(response.stdout).get('busy') is not False:fail('A shared GPU reservation is active or unavailable; nothing was interrupted.')

def idle():
    shared_idle()''')
    change("                fail('A media GPU queue job is unfinished; nothing was interrupted.')","                fail('A media GPU queue job is unfinished; nothing was interrupted.')\n            columns={r[1] for r in db.execute('PRAGMA table_info(media_jobs)')}\n            if 'admissionToken' in columns and db.execute('SELECT 1 FROM media_jobs WHERE admissionToken IS NOT NULL LIMIT 1').fetchone():\n                fail('A shared GPU release is pending; nothing was interrupted.')")
    change("handle.write('OTG_MEDIA_GPU_ROUTING=1\\n')","handle.write('OTG_MEDIA_GPU_ROUTING=1\\nOTG_MEDIA_ADMISSION_CONFIG='+str(ADMISSION)+'\\n')")
    change("'previousRouting':before.get('OTG_MEDIA_GPU_ROUTING')","'previousRouting':before.get('OTG_MEDIA_GPU_ROUTING'),'previousAdmission':before.get('OTG_MEDIA_ADMISSION_CONFIG')")
    change("validate_environment(before,environment(),state.get('previousRouting'))","validate_environment(before,environment(),state.get('previousRouting'),state.get('previousAdmission'))")
    return text


def main():
    root=Path(sys.argv[1]).resolve(strict=True);built=root/'qa-candidate-final'
    if (root/'test-candidate.json').exists():raise RuntimeError('Already staged; never overwrite a release')
    if (TEST/'current').resolve()!=PREVIOUS:raise RuntimeError('TEST changed; stale staging refused')
    if subprocess.check_output(['git','status','--porcelain'],cwd=SOURCE).strip():raise RuntimeError('Commit the exact source checkpoint first')
    checkpoint=subprocess.check_output(['git','rev-parse','HEAD'],cwd=SOURCE,text=True).strip()
    for report in ('production-mode-qualification.json','http-qualification-final.json','publication-audit.json'):
        if not json.loads((root/report).read_text())['passed']:raise RuntimeError('Qualification failed')
    tests=json.loads((root/'contracts.json').read_text())
    if not tests['success'] or tests['numFailedTests']:raise RuntimeError('Contract suite failed')
    if json.loads((built/'config/build-history.json').read_text())['current']!='2.12':raise RuntimeError('Wrong build')
    for file in ('config/build-history.json','scripts/audio-editing-worker.py','scripts/audio-editing-restricted-remote.py','scripts/media-gpu-admission.py'):
        if sha(built/file)!=sha(SOURCE/file):raise RuntimeError('Packaged source changed')
    release=TEST/'releases'/('test3001-media-gpu-routing-2.12-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    def ignore(directory,names):
        skip={name for name in names if name.startswith('.env') or name in ('__pycache__','.git')}
        if Path(directory)==built:skip.add('data')
        if Path(directory).name=='.next':skip.add('cache')
        return skip
    shutil.copytree(built,release,symlinks=True,ignore=ignore)
    (release/'.env.local').symlink_to('/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local')
    (release/'data').symlink_to('/home/shawn-rochford/AI/runtime/test/data')
    (release/'RELEASE_PROVENANCE.json').write_text(json.dumps({'name':release.name,'buildVersion':'2.12','commit':checkpoint,'builtAt':json.loads((root/'candidate-final.json').read_text())['builtAt']},indent=2))
    shutil.copytree(BASE/'helpers',root/'helpers',ignore=shutil.ignore_patterns('__pycache__'))
    (root/'activate-test.py').write_text(adapt_activation((BASE/'activate-test.py').read_text()))
    fixture=(BASE/'test_activation.py').read_text().replace('2.11','2.12')
    fixture=fixture.replace("after={**before,'OTG_MEDIA_GPU_ROUTING':'1'}","after={**before,'OTG_MEDIA_GPU_ROUTING':'1','OTG_MEDIA_ADMISSION_CONFIG':str(app.ADMISSION)}")
    fixture=fixture.replace("if current.resolve()==candidate: value['OTG_MEDIA_GPU_ROUTING']='1'","if current.resolve()==candidate: value.update(OTG_MEDIA_GPU_ROUTING='1',OTG_MEDIA_ADMISSION_CONFIG=str(app.ADMISSION))")
    (root/'test_activation.py').write_text(fixture)
    files=[];links=[]
    for file in sorted(release.rglob('*')):
        rel=str(file.relative_to(release))
        if file.is_symlink():links.append({'file':rel,'target':str(file.resolve(strict=True))})
        elif file.is_file():files.append({'file':rel,'sha256':sha(file)})
    for file in sorted((root/'helpers').glob('*.py')):files.append({'file':str(file.relative_to(root)),'sha256':sha(file),'helper':True})
    receipt={'release':str(release),'expectedCurrent':str(PREVIOUS),'checkpoint':checkpoint,'buildId':(release/'.next/BUILD_ID').read_text().strip(),'buildVersion':'2.12',
        'files':files,'links':links,'admissionSha256':sha(root/'test-admission.json'),'githubPushed':False,'testActivated':False,'prodChanged':False}
    (root/'test-candidate.json').write_text(json.dumps(receipt,indent=2))
    print(json.dumps({'ok':True,'release':str(release),'version':'2.12','activated':False,'prodChanged':False}))


if __name__=='__main__':main()
