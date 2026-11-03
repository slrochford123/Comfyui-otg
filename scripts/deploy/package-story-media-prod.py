"""Package the exact activated TEST build and prepare a pinned production promotion."""
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

SOURCE=Path(__file__).resolve().parents[2]


def sha(file):
    h=hashlib.sha256()
    with Path(file).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
    return h.hexdigest()


def main():
    os.umask(0o077)
    root=Path(sys.argv[1]).resolve(strict=True)
    if root.parent!=Path('/home/shawn-rochford/AI/research') or not root.name.startswith(('experimental-tabs-','h3-nsfw-access-','h3-edit-recovery-','build-2.24-promotion-')):raise RuntimeError('Private release evidence required')
    git=lambda *args:subprocess.check_output(['git',*args],cwd=SOURCE,text=True).strip()
    if git('status','--porcelain'):raise RuntimeError('Commit the reviewed release source before packaging')
    commit=git('rev-parse','HEAD');p=json.loads((root/'activation-plan.json').read_text());test=Path(p['candidate'])
    if Path('/home/shawn-rochford/AI/deploy/otg-test/current').resolve()!=test:raise RuntimeError('Qualified TEST release is not active')
    version=json.loads((test/'config/build-history.json').read_text())['current']
    if version not in ('2.21','2.22','2.23','2.24','2.25','2.26'):raise RuntimeError('Wrong TEST version')
    for row in p['files']:
        file=test/row['file']
        if row.get('link') is not None:
            if not file.is_symlink() or os.readlink(file)!=row['link']:raise RuntimeError('TEST link changed')
        elif sha(file)!=row['sha256']:raise RuntimeError('TEST file changed: '+row['file'])
    name='prod-build-'+version+'-'+commit[:12];release=root/name;release.mkdir(mode=0o700)
    listing=root/'qualified-files.txt';listing.write_text(''.join(row['file']+'\n' for row in p['files']))
    subprocess.run(['rsync','-aL','--files-from='+str(listing),str(test)+'/',str(release)+'/'],check=True)
    # Runtime code must match the committed source; deployment-only helpers can follow packaging.
    for directory in ('app','lib','config'):
        for source in (SOURCE/directory).rglob('*'):
            if source.is_file() and source.suffix in ('.ts','.tsx','.json'):
                original=Path(sys.argv[2])/source.relative_to(SOURCE)
                if original.is_file() and sha(original)!=sha(source):raise RuntimeError('Source changed since qualification: '+str(source.relative_to(SOURCE)))
    identity={'name':name,'buildVersion':version,'commit':commit,'buildId':p['buildId'],'node':'v22.23.4','promotedFromTest':test.name}
    (release/'RELEASE_PROVENANCE.json').write_text(json.dumps(identity,indent=2))
    files=[]
    for file in sorted(release.rglob('*')):
        if file.is_symlink():raise RuntimeError('Unexpected release symlink')
        if file.is_file():files.append({'file':str(file.relative_to(release)),'sha256':sha(file),'bytes':file.stat().st_size})
    (release/'DEPLOYMENT_MANIFEST.json').write_text(json.dumps({**identity,'artifactFiles':files},indent=2))
    old_root=Path('/home/shawn-rochford/AI/research/release-qualification-20261101-DYHhxBWc/promotion')
    old=json.loads((old_root/'activation-plan.json').read_text())
    if version in ('2.25','2.26'):
        old=json.loads(Path('/home/shawn-rochford/AI/research/build-2.24-promotion-20261102-cOz3GMPn/production-plan.json').read_text())
        if old['commit']!='453f9d654580f9466148fd8015b3d7449276407a':raise RuntimeError('Unexpected retirement baseline')
        channel={'productionConfig':old['speechConfig']}
    elif version=='2.24':
        old=json.loads((root/'previous-production-plan.json').read_text())
        if old['commit']!='6d9dd312e1868894d79a1a2a3b86c1bd4099ee2c':raise RuntimeError('Unexpected previous production identity')
        channel={'productionConfig':old['speechConfig']}
    elif version=='2.23':
        old=json.loads(Path('/home/shawn-rochford/AI/research/h3-nsfw-access-20261102-u6QMYEwF/production-plan.json').read_text())
        channel={'productionConfig':old['speechConfig']}
    elif version=='2.22':
        old=json.loads(Path('/home/shawn-rochford/AI/research/experimental-tabs-20261102-ojSrlL1V/production-plan.json').read_text())
        channel={'productionConfig':old['speechConfig']}
    else:channel=json.loads((root/'story-channel.json').read_text())
    guard='/mnt/otg_bulk/build-2.20-promotion-297172e2c7a7/activate-build-2.20.py'
    guard_sha=subprocess.check_output(['ssh','-o','BatchMode=yes','otg-slr','sha256sum '+guard],text=True).split()[0]
    speech_sha=subprocess.check_output(['ssh','-o','BatchMode=yes','otg-slr','sudo -n sha256sum '+shlex.quote(channel['productionConfig'])],text=True).split()[0]
    expected_old={'2.21':'prod-build-2.20-297172e2c7a7','2.22':'prod-build-2.21-ad4b86c62d36','2.23':'prod-build-2.22-e81e31e42955','2.24':'prod-build-2.23-6d9dd312e186','2.25':'prod-build-2.24-453f9d654580','2.26':'prod-build-2.24-453f9d654580'}[version]
    expected_old='/mnt/otg_bulk/slr-offload/opt-otg/releases/'+expected_old
    plan={**identity,'candidate':'/opt/otg/releases/'+name,'expectedOld':expected_old,
        'manifestSha256':sha(release/'DEPLOYMENT_MANIFEST.json'),'previousGuardSha256':guard_sha,'runtime':old['runtime'],'rootEngineConfig':old['rootEngineConfig'],
        'cpuRoot':old['cpuRoot'],'cpuWorkerSha256':old['cpuWorkerSha256'],'speechConfig':channel['productionConfig'],'speechConfigSha256':speech_sha,'testRelease':str(test)}
    if version in ('2.25','2.26'):
        plan.update({key:old[key] for key in ('nsfwConfig','nsfwConfigSha256','nsfwRoot','workerProbeConfig','workerProbeConfigSha256','workerProbePins','workerProbeLocalHelper','workerProbeLocalHelperSha256')})
    elif version=='2.22':
        nsfw=json.loads((root/'h3-controller.json').read_text())
        plan.update(nsfwConfig=nsfw['config'],nsfwConfigSha256=nsfw['configSha256'],nsfwRoot=nsfw['storage'])
    elif version=='2.24':
        nsfw=json.loads((root/'h3-controller.json').read_text())
        plan.update(nsfwConfig=nsfw['config'],nsfwConfigSha256=nsfw['configSha256'],nsfwRoot=nsfw['storage'],expectedNsfwStorageSha256=old['nsfwConfigSha256'])
        plan.update({key:old[key] for key in ('workerProbeConfig','workerProbeConfigSha256','workerProbePins','workerProbeLocalHelper','workerProbeLocalHelperSha256')})
    elif version=='2.23':
        plan.update({key:old[key] for key in ('nsfwConfig','nsfwConfigSha256','nsfwRoot')})
        probe=json.loads((root/'comfy-probe-channel.json').read_text())
        plan.update(workerProbeConfig=probe['config'],workerProbeConfigSha256=probe['configSha256'],workerProbePins=probe['pins'])
        plan['workerProbeLocalHelper']=probe['localHelper']
        plan['workerProbeLocalHelperSha256']=probe['localHelperSha256']
    plan_file=root/'production-plan.json';plan_file.write_text(json.dumps(plan,indent=2))
    template=(SOURCE/'scripts/deploy/activate-story-media-prod.py').read_text()
    if template.count('__ACTIVATION_PLAN_SHA256__')!=1:raise RuntimeError('Activator template changed')
    activator=root/('activate-build-'+version+'.py');activator.write_text(template.replace('__ACTIVATION_PLAN_SHA256__',sha(plan_file)))
    archive=root/(name+'.tar.gz');subprocess.run(['tar','-czf',str(archive),'-C',str(root),name],check=True)
    package={**identity,'archive':str(archive),'archiveSha256':sha(archive),'stage':'/mnt/otg_bulk/build-'+version+'-promotion-'+commit[:12],
        'candidate':plan['candidate'],'planSha256':sha(plan_file),'activatorSha256':sha(activator),'activated':False}
    (root/'production-package.json').write_text(json.dumps(package,indent=2));print(json.dumps(package))


if __name__=='__main__':main()
