"""Stage the qualified Build 2.11 TEST checkpoint, without service control.

Copies the already reviewed TEST activation transaction unchanged, pins its
helpers and complete artifact inventory, and reuses the existing TEST env/data
links. Run the generated activate-test.py with owner sudo on shawn afterward.
"""
import datetime
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

SOURCE = Path(__file__).resolve().parents[2]
EVIDENCE = Path("/home/shawn-rochford/AI/research/private-audio-channel-20261029-1ude1930")
PREVIOUS = Path("/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-media-gpu-routing-2.10-20261029T201859Z")
TEST = Path("/home/shawn-rochford/AI/deploy/otg-test")
BASE = Path("/home/shawn-rochford/AI/research/build-2.10-checkpoint-20261029-zuXmn9qx")


def sha(file):
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    research = Path(sys.argv[1]).resolve(strict=True)
    if not re.fullmatch(r"/home/shawn-rochford/AI/research/media-gpu-routing-20261029-[A-Za-z0-9]+", str(research)):
        raise RuntimeError("Use the isolated qualified build")
    if (EVIDENCE / "test-candidate.json").exists():
        raise RuntimeError("Checkpoint is already staged; never overwrite it")
    if (TEST / "current").resolve(strict=True) != PREVIOUS:
        raise RuntimeError("TEST changed; stale staging refused")
    if subprocess.check_output(["git", "status", "--porcelain"], cwd=SOURCE).strip():
        raise RuntimeError("Commit the exact source checkpoint before staging")
    checkpoint = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=SOURCE, text=True).strip()
    contracts = json.loads((EVIDENCE / "contracts-final.json").read_text())
    if not contracts["success"] or contracts["numFailedTests"]:
        raise RuntimeError("Contracts did not pass")
    for file in (research / "http-qualification-final.json", EVIDENCE / "app-http-qualification.json", EVIDENCE / "publication-audit.json"):
        if not json.loads(file.read_text())["passed"]:
            raise RuntimeError("Qualification or publication audit failed")
    built = research / "qa-candidate-final"
    if json.loads((built / "config/build-history.json").read_text())["current"] != "2.11":
        raise RuntimeError("Wrong build version")
    for name in ("config/build-history.json", "scripts/audio-editing-release-bootstrap.cjs", "scripts/audio-editing-worker.py",
                 "scripts/audio-editing-remote.py", "scripts/audio-editing-restricted-remote.py", "scripts/audio-editing-gateway.py"):
        if sha(built / name) != sha(SOURCE / name):
            raise RuntimeError("Packaged worker/config source changed")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    release = TEST / "releases" / ("test3001-media-gpu-routing-2.11-" + stamp)

    def ignore(directory, names):
        skip = {name for name in names if name.startswith(".env") or name in ("__pycache__", ".git")}
        if Path(directory) == built:
            skip.add("data")
        if Path(directory).name == ".next":
            skip.add("cache")
        return skip

    shutil.copytree(built, release, symlinks=True, ignore=ignore)
    (release / ".env.local").symlink_to("/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local")
    (release / "data").symlink_to("/home/shawn-rochford/AI/runtime/test/data")
    provenance = {"name": release.name, "buildVersion": "2.11", "commit": checkpoint,
        "builtAt": json.loads((research / "candidate-final.json").read_text())["builtAt"], "testOnly": True, "productionQualified": False}
    (release / "RELEASE_PROVENANCE.json").write_text(json.dumps(provenance, indent=2))
    helpers = EVIDENCE / "helpers"
    shutil.copytree(BASE / "helpers", helpers, ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copyfile(BASE / "activate-test.py", EVIDENCE / "activate-test.py")
    # Mechanical fixture-version update; production/service-control logic is not rewritten.
    (EVIDENCE / "test_activation.py").write_text((BASE / "test_activation.py").read_text().replace("2.10", "2.11"))
    files, links = [], []
    for file in sorted(release.rglob("*")):
        relative = str(file.relative_to(release))
        if file.is_symlink():
            links.append({"file": relative, "target": str(file.resolve(strict=True))})
        elif file.is_file():
            files.append({"file": relative, "sha256": sha(file)})
    for file in sorted(helpers.glob("*.py")):
        files.append({"file": str(file.relative_to(EVIDENCE)), "sha256": sha(file), "helper": True})
    receipt = {"release": str(release), "expectedCurrent": str(PREVIOUS), "checkpoint": checkpoint,
        "buildId": (release / ".next/BUILD_ID").read_text().strip(), "buildVersion": "2.11", "files": files,
        "links": links, "testActivated": False, "prodChanged": False, "githubPushed": False}
    (EVIDENCE / "test-candidate.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps({"ok": True, "release": str(release), "version": "2.11", "activated": False, "prodChanged": False}))


if __name__ == "__main__":
    main()
