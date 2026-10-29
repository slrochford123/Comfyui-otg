"""Guarded Build 2.12 personal-research activation, run with owner sudo on SLR.

The packager pins the plan hash. Preserve existing auth/permissions/env/data;
add only six explicit media runtime settings. No job reconciliation, GPU reset,
worker restart, package install, or database restoration is implemented here.
"""
import argparse
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.request
import uuid

PLAN_SHA="__ACTIVATION_PLAN_SHA256__"
GUARDS={
 "/opt/otg/staging/build-2-a3f9ca414891/activate-build-2.py":"82cce7e04708ff3857f64946c55f4a8683c750753627b5a61254c1a099ae446a",
 "/opt/otg/staging/build-2.08-82b83035d67c/activate-build-2.08.py":"da4b6c057eefca53fcb1ee50ce5fd47905ac1457a12889f25505699266f5787a"}
OLD=Path("/mnt/otg_bulk/slr-offload/opt-otg/releases/prod-build-2.08-82b83035d67c")
FEATURE_KEYS={"OTG_PRIVATE_RESEARCH_MEDIA","OTG_MEDIA_GPU_ROUTING","OTG_AUDIO_EDITING_ENABLED",
 "OTG_MEDIA_ADMISSION_CONFIG","OTG_AUDIO_ENGINE_CONFIG","OTG_AUDIO_WORKER_SCRIPT"}
QUEUE_MIGRATE="""
const slrFs=require('node:fs'),slrPath=require('node:path');
const slrFile=slrPath.join(process.env.OTG_DATA_DIR,'media-gpu-queue/queue.sqlite');
if(slrFs.existsSync(slrFile)){
 const slrDb=new(require('better-sqlite3'))(slrFile);
 try{const slrCols=new Set(slrDb.prepare('PRAGMA table_info(media_jobs)').all().map(r=>r.name));
 for(const [n,t] of [['admissionOwner','TEXT'],['admissionToken','INTEGER'],['admissionPhase','TEXT']])
 if(!slrCols.has(n))slrDb.exec('ALTER TABLE media_jobs ADD COLUMN '+n+' '+t);
 }finally{slrDb.close();}
}
"""


def digest(file):
    value=hashlib.sha256()
    with Path(file).open("rb") as stream:
        for block in iter(lambda:stream.read(1024*1024),b""):value.update(block)
    return value.hexdigest()


def load(name,file,expected):
    file=Path(file)
    if file.is_symlink() or digest(file)!=expected:raise RuntimeError("Reviewed deployment guard changed")
    spec=importlib.util.spec_from_file_location(name,file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def validate_package(plan):
    if plan.get("buildVersion")!="2.12" or not re.fullmatch(r"[a-f0-9]{40}",plan.get("commit","")):raise RuntimeError("Incorrect activation identity")
    candidate=Path(plan["candidate"])
    if candidate!=Path("/opt/otg/releases/prod-build-2.12-"+plan["commit"][:12]) or (candidate/"DO_NOT_ACTIVATE").exists():raise RuntimeError("Incorrect or superseded candidate")
    if digest(candidate/"RELEASE_PROVENANCE.json")!=plan["manifestSha256"]:raise RuntimeError("Pinned package manifest changed")
    manifest=json.loads((candidate/"RELEASE_PROVENANCE.json").read_text())
    for key in ("commit","buildVersion","buildId","node"):
        if manifest.get(key)!=plan.get(key):raise RuntimeError("Package identity mismatch")
    expected=set()
    for row in manifest["artifactFiles"]:
        relative=Path(row["file"])
        if relative.is_absolute() or ".." in relative.parts:raise RuntimeError("Invalid artifact path")
        file=candidate/relative
        if file.is_symlink() or not file.is_file() or digest(file)!=row["sha256"]:raise RuntimeError("Package integrity failed")
        expected.add(str(relative))
    actual=set()
    for parent,dirs,files in os.walk(candidate,followlinks=False):
        for name in [*dirs,*files]:
            file=Path(parent)/name;relative=str(file.relative_to(candidate))
            if file.is_symlink():
                if relative not in {"data",".env.local"}:raise RuntimeError("Unexpected artifact link")
            elif file.is_file():actual.add(relative)
    if actual!=expected|{"RELEASE_PROVENANCE.json"}:raise RuntimeError("Artifact inventory changed")
    if (candidate/".next/BUILD_ID").read_text().strip()!=plan["buildId"]:raise RuntimeError("Build identity mismatch")
    return candidate


def preserve_environment(before,after,flags):
    if after.get("OTG_ENV")!="prod" or after.get("PORT")!="3000":raise RuntimeError("Production identity changed")
    if set(flags)!=FEATURE_KEYS or any(after.get(k)!=v for k,v in flags.items()):raise RuntimeError("Production media runtime settings mismatch")
    for key in set(before)|set(after):
        if key.startswith(("OTG_","AUTH_","OPENAI_","WHISPER_","INDEX_","SEED_","ADMIN_","COMFY_","NEXTAUTH_")) and key not in FEATURE_KEYS and after.get(key)!=before.get(key):
            raise RuntimeError("Existing production configuration was not preserved")


def extra_idle(data,plan):
    terminal={"completed","failed","canceled","cancelled"}
    for pattern in ("h3-special/*/*/jobs/*.json","audio-editing/*/*/jobs/*/status.json"):
        for file in data.glob(pattern):
            if json.loads(file.read_text()).get("status") not in terminal:raise RuntimeError("An application media operation is unfinished; nothing was interrupted")
    queue=data/"media-gpu-queue/queue.sqlite"
    if queue.exists():
        with sqlite3.connect(queue.resolve().as_uri()+"?mode=ro",uri=True) as db:
            if db.execute("SELECT 1 FROM media_jobs WHERE status IS NULL OR lower(status) NOT IN ('completed','failed','canceled','cancelled') LIMIT 1").fetchone():raise RuntimeError("The application GPU queue is unfinished")
            columns={r[1] for r in db.execute("PRAGMA table_info(media_jobs)")}
            if "admissionToken" in columns and db.execute("SELECT 1 FROM media_jobs WHERE admissionToken IS NOT NULL LIMIT 1").fetchone():raise RuntimeError("A physical GPU reservation is awaiting release")
    ledger=Path(plan["runtime"]["script"]).parent/"admission.sqlite"
    with sqlite3.connect(ledger.resolve().as_uri()+"?mode=ro",uri=True) as db:
        if db.execute("SELECT 1 FROM grants LIMIT 1").fetchone():raise RuntimeError("A shared physical GPU reservation is active; nothing was interrupted")


def check_test(plan):
    """Normal temporary TEST account; no existing permissions/credentials edited."""
    base="http://100.75.162.64:3001";cookie=""
    def request(route,body=None):
        headers={"User-Agent":"SLR-Deployment-Health/2","Cache-Control":"no-cache","Cookie":cookie}
        if body is not None:headers["Content-Type"]="application/json"
        return urllib.request.urlopen(urllib.request.Request(base+route,data=json.dumps(body).encode() if body is not None else None,headers=headers),timeout=15)
    username="promotionqa_"+secrets.token_hex(5);password=secrets.token_urlsafe(32)
    with request("/api/auth/signup",{"username":username,"email":username+"@test.invalid","password":password}):pass
    with request("/api/auth/login",{"identifier":username,"password":password}) as response:
        cookie="; ".join(value.split(";")[0] for value in response.headers.get_all("Set-Cookie"))
    try:
        with request("/api/app/build") as response:identity=json.load(response)
        if identity.get("buildVersion")!="2.12" or identity.get("commit")!=plan["commit"]:raise RuntimeError("Activate the exact qualified Build 2.12 on TEST first")
        with request("/_next/static/"+plan["buildId"]+"/_buildManifest.js") as response:
            if response.status!=200:raise RuntimeError("TEST is not serving the exact qualified build")
        with request("/api/media-gpu") as response:media=json.load(response)
        if not media.get("enabled") or media.get("sharedAdmission",{}).get("authorityId")!=plan["runtime"]["authorityId"]:raise RuntimeError("TEST must use the same qualified physical GPU authority")
        with request("/api/edit-video/audio") as response:audio=json.load(response)
        if not audio.get("ok") or not audio.get("capabilities",{}).get("pythonReady"):raise RuntimeError("Live TEST Audio Editing is not available")
    finally:
        with request("/api/auth/logout",{}):pass


def validate_runtime(plan):
    runtime=plan["runtime"]
    root=Path(runtime["root"])
    if root.parent!=Path("/mnt/otg_bulk/slr-research-media-20261029") or root.is_symlink():raise RuntimeError("Unexpected private runtime")
    for row in runtime["pins"]:
        file=Path(row["file"])
        if not file.is_relative_to(root) or file.is_symlink() or digest(file)!=row["sha256"]:raise RuntimeError("Private runtime prerequisite changed")
    cfg=json.loads(Path(runtime["engineConfig"]).read_text())
    if cfg.get("localGpu")!="rtx5060ti" or cfg.get("python")!="/usr/bin/python3" or cfg.get("ffmpeg")!="/usr/bin/ffmpeg" or cfg.get("ffprobe")!="/usr/bin/ffprobe" or cfg.get("releaseIdleCaches"):
        raise RuntimeError("Private audio runtime policy mismatch")
    for gpu,host in (("rtx3090","shawn-rochford@100.75.162.64"),("rtx5060ti","slrochford123@127.0.0.1")):
        target=cfg.get('transports',{}).get(gpu,{})
        if target.get('protocol')!='slr-audio-v1' or not target.get('qualified') or target.get('host')!=host:raise RuntimeError('An unprivileged audio worker is not qualified')
        args=['/usr/bin/ssh','-F','/dev/null','-o','BatchMode=yes','-o','ConnectTimeout=5','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes',
              '-o','UserKnownHostsFile='+target['knownHostsFile'],'-i',target['identityFile'],'--',host,'slr-audio-v1']
        probe=subprocess.run(args,input=b'{"action":"probe"}\n',capture_output=True,timeout=15)
        if probe.returncode or json.loads(probe.stdout).get('gpu')!=gpu:raise RuntimeError('A restricted audio worker is unavailable; no application was stopped')
    if any(value.get('cpu') for value in cfg.get('verified',{}).values()):raise RuntimeError('AI inference cannot execute in the root controller')
    if not Path(cfg["python"]).is_file():raise RuntimeError("The isolated audio Python runtime is missing")


def controller_config(cfg,root):
    result=json.loads(json.dumps(cfg))
    for gpu,target in result['transports'].items():
        target['identityFile']=str(root/'keys'/(gpu+'.key'))
        target['knownHostsFile']=str(root/'keys'/(gpu+'.known_hosts'))
    return result


def prepare_root_controller(plan):
    # Only standard-library controllers execute as root. Their connection/config
    # files must also reside under a root-owned, non-writable trusted ancestor.
    parent=Path('/var/lib/slr-private-media-runtime');root=parent/('build-2.12-'+plan['commit'][:12])
    if Path(plan['rootEngineConfig'])!=root/'engines.json':raise RuntimeError('Unexpected root controller path')
    for directory in (parent.parent,parent,root,root/'keys'):
        if not directory.exists():directory.mkdir(mode=0o700)
        state=directory.stat()
        if directory.is_symlink() or state.st_uid!=0 or state.st_mode&0o022:raise RuntimeError('Unsafe root controller directory')
    cfg=json.loads(Path(plan['runtime']['engineConfig']).read_text());derived=controller_config(cfg,root)
    content=json.dumps(derived,indent=2,sort_keys=True)
    if hashlib.sha256(content.encode()).hexdigest()!=plan['rootEngineConfigSha256']:raise RuntimeError('Derived root controller configuration changed')
    for gpu,target in cfg['transports'].items():
        for field in ('identityFile','knownHostsFile'):
            destination=Path(derived['transports'][gpu][field]);source=Path(target[field])
            if destination.exists():
                if destination.is_symlink() or destination.stat().st_uid!=0 or digest(destination)!=digest(source):raise RuntimeError('Existing controller credential changed')
            else:
                with destination.open('xb') as output:output.write(source.read_bytes())
                destination.chmod(0o400)
    file=root/'engines.json'
    if file.exists():
        if file.is_symlink() or file.stat().st_uid!=0 or digest(file)!=plan['rootEngineConfigSha256']:raise RuntimeError('Existing root controller config changed')
    else:
        with file.open('x') as output:output.write(content)
        file.chmod(0o400)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--check-only",action="store_true");args=parser.parse_args()
    if os.geteuid()!=0 or socket.gethostname()!="slr":raise RuntimeError("Owner sudo is required on SLR / the 5060 Ti PC")
    os.umask(0o077);stage=Path(__file__).resolve().parent
    if digest(stage/"activation-plan.json")!=PLAN_SHA:raise RuntimeError("Pinned activation plan changed")
    plan=json.loads((stage/"activation-plan.json").read_text())
    if stage!=Path("/opt/otg/staging/build-2.12-"+plan["commit"][:12]):raise RuntimeError("Unexpected activation stage")
    modules=[load("private_media_guard_"+str(i),file,sha) for i,(file,sha) in enumerate(GUARDS.items())];m,prior=modules
    with m.ACTIVATION_LOCK.open("a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        candidate=validate_package(plan);validate_runtime(plan)
        if m.CURRENT.resolve(strict=True)!=OLD:raise RuntimeError("PROD pointer changed; stale activation refused")
        old_pid=m.property_value("MainPID");old_exe=(m.PROC/old_pid/"exe").resolve(strict=True)
        if (m.PROC/old_pid/"cwd").resolve()!=OLD:raise RuntimeError("Live production process identity mismatch")
        old_env=prior.process_environment(old_pid)
        flags={"OTG_PRIVATE_RESEARCH_MEDIA":"1","OTG_MEDIA_GPU_ROUTING":"1","OTG_AUDIO_EDITING_ENABLED":"1",
               "OTG_MEDIA_ADMISSION_CONFIG":plan["runtime"]["admissionConfig"],"OTG_AUDIO_ENGINE_CONFIG":plan["rootEngineConfig"],
               "OTG_AUDIO_WORKER_SCRIPT":str(candidate/"scripts/audio-editing-worker.py")}
        if old_env.get("OTG_ENV")!="prod" or old_env.get("PORT")!="3000":raise RuntimeError("Wrong existing production environment")
        if digest(m.APP_ENV)!=digest(OLD/".env.local"):raise RuntimeError("Production environment linkage changed")
        for key in ("OTG_DATA_DIR","OTG_DATA_ROOT"):
            if old_env.get(key) and Path(old_env[key]).resolve()!=m.DATA.resolve():raise RuntimeError("Unexpected production data root")
        runtime=load("private_media_systemd",candidate/"scripts/deploy/systemd_runtime.py",plan["systemdRuntimeSha256"])
        m.final_override_name=runtime.final_override_name
        m.public_application_gates();m.application_gates();m.maintenance_gates();m.idle_gates();extra_idle(m.DATA,plan);m.active_child_gates(old_pid)
        check_test(plan)
        galleries=[prior.verify_gallery_source(old_env,gpu) for gpu in ("3090","5060")]
        if m.NODE.resolve().stat().st_uid!=0 or m.run([str(m.NODE),"--version"])!="v22.23.4":raise RuntimeError("Expected root-owned Node22 unavailable")
        m.run([str(m.NODE),"-e","new(require('better-sqlite3'))(':memory:').close();require('sharp')({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer().catch(()=>process.exit(1));"],cwd=candidate)
        if args.check_only:
            print(json.dumps({"ok":True,"checkOnly":True,"buildVersion":"2.12","activated":False,"productionFilesChanged":False}));return
        prepare_root_controller(plan)
        transaction=m.BACKUPS/("prod-build-2.12-activation-"+datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+"-"+uuid.uuid4().hex[:8]);transaction.mkdir(mode=0o700,parents=True)
        report={"commit":plan["commit"],"buildVersion":"2.12","oldRelease":str(OLD),"oldPointer":os.readlink(m.CURRENT),"oldPid":int(old_pid),
                "candidate":str(candidate),"transaction":str(transaction),"activated":False,"rolledBack":False,"authorityId":plan["runtime"]["authorityId"]}
        def save(): (transaction/"activation-report.json").write_text(json.dumps(report,indent=2))
        def phase(name):report["stage"]=name;save();print(name,flush=True)
        samples=m.media_samples();catalog_hash=digest(m.DATA/"h3_lora_catalog.json");override=None;override_created=False;stopped=switched=False
        try:
            for parent,dirs,files in os.walk(candidate,followlinks=False):
                for file in [Path(parent),*(Path(parent)/name for name in files)]:
                    if not file.is_symlink():os.chown(file,0,0)
            m.idle_gates();extra_idle(m.DATA,plan);m.active_child_gates(old_pid)
            if m.CURRENT.resolve()!=OLD or m.property_value("MainPID")!=old_pid:raise RuntimeError("Production changed during preparation")
            phase("Stop only otg-prod.service for consistent final backups")
            stopped=True;m.run(["/usr/bin/systemctl","stop",m.UNIT]);m.idle_gates();extra_idle(m.DATA,plan)
            phase("Back up protected settings, existing environment references and SQLite databases")
            output=m.run(["/usr/bin/python3",str(candidate/"scripts/maintenance/backup-prod-protected.py")])
            report["protectedBackup"]=next(line.split(": ",1)[1] for line in output.splitlines() if line.startswith("Private protected-config"))
            references={m.APP_ENV,m.COMPAT}
            references.update(Path(value) for value in re.findall(r"(/[^\s]+)\s+\(ignore_errors=(?:yes|no)\)",m.property_value("EnvironmentFiles")) if Path(value).exists())
            env_hashes={str(file):digest(file) for file in references}
            for file in references:
                target=transaction/"environment"/str(file).lstrip("/");target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(file,target);target.chmod(0o600)
            if (m.DATA/"media-gpu-queue/queue.sqlite").exists():m.DATABASES=(*m.DATABASES,"media-gpu-queue/queue.sqlite")
            baseline=m.snapshot_databases(transaction/"final-databases")
            rehearsal=transaction/"migration-rehearsal";shutil.copytree(transaction/"final-databases",rehearsal)
            migrate=[str(m.NODE),"-r","./scripts/register-ts-worker.cjs","-e",m.MIGRATE+QUEUE_MIGRATE]
            phase("Rehearse exact-release additive migrations on fresh backups")
            m.run(migrate,cwd=candidate,env=m.migration_environment(old_env,rehearsal),log=transaction/"migrations.private.log")
            for name in m.DATABASES:m.assert_preserved(baseline[name],m.inspect_database(rehearsal/name,baseline[name]))
            phase("Apply only rehearsed migrations and verify original users, sessions and rows")
            m.run(migrate,cwd=candidate,env=m.migration_environment(old_env,m.DATA),log=transaction/"migrations.private.log")
            for name in m.DATABASES:m.assert_preserved(baseline[name],m.inspect_database(m.DATA/name,baseline[name]))
            report["originalRowsPreserved"]=True
            m.CANDIDATE=candidate;m.link_release_file("data",m.DATA);m.link_release_file(".env.local",m.APP_ENV)
            flag_file=transaction/"private-media.env";flag_file.write_text("".join(k+"="+v+"\n" for k,v in flags.items()));flag_file.chmod(0o600)
            override=m.OVERRIDES/m.final_override_name(m.property_value("DropInPaths").split())
            with override.open("x") as stream:
                override_created=True
                stream.write("[Service]\nWorkingDirectory="+str(m.CURRENT)+"\nExecStart=\nExecStart="+str(m.NODE)+" "+str(m.CURRENT/"server.js")+"\nEnvironmentFile="+str(flag_file)+"\n")
            override.chmod(0o644);report.update(override=str(override),overrideSha256=digest(override));save()
            m.run(["/usr/bin/systemctl","daemon-reload"]);m.assert_exec(m.property_value("ExecStart"))
            phase("Switch exact Build 2.12 and verify production identity and preserved configuration")
            m.atomic_switch(candidate);switched=True;m.run(["/usr/bin/systemctl","start",m.UNIT])
            deadline=time.monotonic()+90
            while True:
                try:
                    pid=m.property_value("MainPID")
                    if m.property_value("ActiveState")!="active" or pid==old_pid or (m.PROC/pid/"cwd").resolve()!=candidate.resolve() or (m.PROC/pid/"exe").resolve()!=m.NODE.resolve():raise RuntimeError("New production runtime identity not verified")
                    preserve_environment(old_env,prior.process_environment(pid),flags);m.application_gates();break
                except Exception:
                    if time.monotonic()>=deadline:raise
                    time.sleep(1)
            m.public_application_gates();m.verify_media(samples)
            if digest(m.DATA/"h3_lora_catalog.json")!=catalog_hash:raise RuntimeError("Existing LoRA catalog changed")
            if any(digest(Path(file))!=sha for file,sha in env_hashes.items()):raise RuntimeError("An existing environment file changed")
            for source in galleries:
                if prior.verify_gallery_source(prior.process_environment(pid),source["target"])!=source:raise RuntimeError("Existing gallery source changed")
            report.update(activated=True,pid=int(pid),health=200,node="v22.23.4",existingPoliciesPreserved=True,mediaSamplesRetained=len(samples),authenticatedAndroidLogin="Owner verification remains separate")
            save();prior.publish_result(stage,report,"activation-result.json")
            print("PROD Build 2.12 ACTIVE: PID="+pid+" health=200. Existing users, settings and media retained.");print("Rollback record: "+str(transaction/"activation-report.json"))
        except BaseException as error:
            report.update(failureType=type(error).__name__,failureStage=report.get("stage"));save()
            if switched:
                try:m.idle_gates();extra_idle(m.DATA,plan);m.active_child_gates(m.property_value("MainPID"))
                except Exception:
                    report["rollbackPausedForActiveWork"]=True;save();prior.publish_result(stage,report,"activation-last-attempt.json")
                    raise RuntimeError("Activation needs attention; rollback paused to avoid interrupting new or unverifiable work. Inspect the private report") from None
                m.run(["/usr/bin/systemctl","stop",m.UNIT]);m.atomic_switch(report["oldPointer"])
            if override_created and override and override.exists():override.unlink()
            m.run(["/usr/bin/systemctl","daemon-reload"])
            if stopped:
                m.run(["/usr/bin/systemctl","start",m.UNIT]);deadline=time.monotonic()+60
                while True:
                    try:
                        pid=m.property_value("MainPID")
                        if (m.PROC/pid/"cwd").resolve()!=OLD or (m.PROC/pid/"exe").resolve()!=old_exe:raise RuntimeError("Rollback identity not verified")
                        m.application_gates();break
                    except Exception:
                        if time.monotonic()>=deadline:raise RuntimeError("URGENT: previous application health not confirmed") from None
                        time.sleep(1)
            report["rolledBack"]=True;save();prior.publish_result(stage,report,"activation-last-attempt.json")
            raise RuntimeError("Activation failed; previous application restored. No database was restored or media deleted. Inspect the private transaction report") from None


if __name__=="__main__":
    try:main()
    except Exception as error:
        print(str(error) if isinstance(error,RuntimeError) else "Activation refused: "+type(error).__name__+"; no secrets displayed")
        sys.exit(1)
