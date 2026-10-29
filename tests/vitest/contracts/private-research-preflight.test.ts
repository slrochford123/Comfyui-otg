import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

describe("read-only PROD private-research readiness", () => {
  const file = path.join(process.cwd(), "scripts/deploy/check-private-research-readiness.py");
  const source = fs.readFileSync(file, "utf8");
  it("parses without creating Python cache files or running the probe", () => {
    const result = spawnSync("/usr/bin/python3", ["-c", "import ast,sys;ast.parse(open(sys.argv[1]).read())", file]);
    expect(result.status).toBe(0);
  });
  it("supports help without privileges or live operations", () => {
    const result = spawnSync("/usr/bin/python3", [file, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout.replace(/\s+/g, " ")).toContain("Never activate, install, cancel or restart");
  });
  it("fingerprints empty, small and multi-block files without the Python 3.11 helper", () => {
    const code = `import hashlib,pathlib,runpy,sys,tempfile
if hasattr(hashlib,'file_digest'): delattr(hashlib,'file_digest')
module=runpy.run_path(sys.argv[1],run_name='readiness_fixture')
with tempfile.TemporaryDirectory(prefix='slr-readiness-hash-') as directory:
    file=pathlib.Path(directory)/'fixture.bin'
    for data in (b'',b'abc',b'fixture-bytes'*200000):
        file.write_bytes(data)
        assert module['fingerprint'](file)==hashlib.sha256(data).hexdigest()
print('Three fingerprint fixtures passed')
`;
    const result = spawnSync("/usr/bin/python3", ["-c", code, file], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Three fingerprint fixtures passed");
  });
  it("completes the full diagnostic against isolated fixtures without touching services", () => {
    const code = `import io,json,os,pathlib,runpy,sys,tempfile,types
from unittest.mock import patch
module=runpy.run_path(sys.argv[1],run_name='readiness_fixture')
namespace=module['main'].__globals__
with tempfile.TemporaryDirectory(prefix='slr-readiness-flow-') as directory:
    root=pathlib.Path(directory);data=root/'data';data.mkdir()
    expected=pathlib.Path.cwd().resolve();current=root/'current';current.symlink_to(expected)
    config=root/'config.env';config.write_text('NON_SECRET_FIXTURE=1\\n')
    namespace.update(CURRENT=current,EXPECTED=expected,DATA=data,__file__=str(root/'fixture.py'))
    values={'MainPID':str(os.getpid()),'ActiveState':'active','EnvironmentFiles':str(config)+' (ignore_errors=no)'}
    namespace['property_value']=lambda name:values[name]
    namespace['process_env']=lambda pid:{'OTG_ENV':'prod','PORT':'3000','OTG_DATA_DIR':str(data)}
    namespace['health']=lambda:200
    namespace['config_summary']=lambda file:{'configExists':True}
    namespace['probe_ssh']=lambda env:{'configured':True,'pythonAccess':False,'reason':'isolated fixture'}
    original_uid,original_gid=os.getuid(),os.getgid()
    queue=json.dumps({'queue_running':[],'queue_pending':[]})
    with patch.object(namespace['os'],'geteuid',return_value=0),patch.object(namespace['socket'],'gethostname',return_value='slr'),patch.object(namespace['pwd'],'getpwnam',return_value=types.SimpleNamespace(pw_uid=original_uid,pw_gid=original_gid)),patch.object(namespace['os'],'chown') as chown,patch.object(namespace['urllib'].request,'urlopen',side_effect=lambda *a,**k:io.StringIO(queue)),patch.object(sys,'argv',['fixture.py']):
        namespace['main']()
        assert chown.call_count==1
    reports=list(root.glob('private-research-readiness-*.json'));assert len(reports)==1
    report=json.loads(reports[0].read_text());assert report['readOnly']
    assert report['servicesChanged'] is False and report['jobsChanged'] is False
    assert report['prodHealthAfter']==200 and len(report['queues'])==3
    assert config.read_text()=='NON_SECRET_FIXTURE=1\\n'
print('Full read-only fixture passed')
`;
    const result = spawnSync("/usr/bin/python3", ["-c", code, file], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Full read-only fixture passed");
  });
  it("does not contain deployment, package installation or GPU interruption commands", () => {
    expect(source).not.toMatch(/['"](?:restart|stop|start|daemon-reload|kill|pkill|pip|apt|nvidia-smi --gpu-reset)['"]/);
    expect(source).not.toContain("/interrupt");
    expect(source).not.toContain("authorized_keys");
    expect(source).toContain("if os.geteuid()!=0 or socket.gethostname()!='slr'");
  });
  it("uses only the existing SSH identity and preserves release, PID and config", () => {
    expect(source).toContain("OTG_SHAWN_PROCESS_PROBE_IDENTITY_FILE");
    expect(source).toContain("'IdentitiesOnly=yes'");
    expect(source).toContain("fingerprint(Path(file))!=digest");
    expect(source).toContain("property_value('MainPID')!=pid");
    expect(source).toContain("'applicationEnablementStillRequired':True");
  });
});
