"""Private loopback built-app qualification on SLR. Never manages services.

Arguments: candidate directory, isolated Node22 binary, private engines.json.
Runs real short MossFormer2 inference once per card after idle checks. Uses only
synthetic original test media, isolated accounts/data and ephemeral auth secret.
"""
import hashlib
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid


def main():
    if socket.gethostname() != "slr" or os.geteuid() == 0:
        raise RuntimeError("Use the unprivileged SLR operator")
    os.umask(0o077)
    app, node, engine = (Path(p).resolve(strict=True) for p in sys.argv[1:4])
    production_mode="--production" in sys.argv
    admission=next((arg.split("=",1)[1] for arg in sys.argv[4:] if arg.startswith("--admission=")),None)
    root = app.parent
    data = root / "http-data"
    data.mkdir(mode=0o700)  # New evidence only, never reuse accounts/job caches.
    config = json.loads(engine.read_text())
    if config.get("localGpu") != "rtx5060ti" or not config["transports"]["rtx3090"]["qualified"]:
        raise RuntimeError("Private dual-host runtime not configured")
    if subprocess.check_output([str(node), "--version"], text=True).strip() != "v22.23.4":
        raise RuntimeError("Pinned isolated Node unavailable")
    subprocess.run([str(node), "-e", "const D=require('better-sqlite3');new D(':memory:').close()"], cwd=app, check=True)
    base = "http://127.0.0.1:3310"
    report = {"kind": "Actual isolated built-app API with real short audio inference on SLR", "checks": [], "passed": False}

    def production():
        pid = subprocess.check_output(["systemctl", "show", "otg-prod.service", "-p", "MainPID", "--value"], text=True).strip()
        pointer = str(Path("/opt/otg/current-prod").resolve())
        with urllib.request.urlopen("http://127.0.0.1:3000/api/healthz", timeout=5) as response:
            assert response.status == 200
        return {"pid": pid, "release": pointer, "health": 200}

    def idle(gpu):
        urls = ["http://100.75.162.64:8188", "http://100.75.162.64:8189"] if gpu == "rtx3090" else ["http://100.98.212.116:8188"]
        for url in urls:
            with urllib.request.urlopen(url + "/queue", timeout=4) as response:
                q = json.load(response)
            assert q["queue_running"] == [] and q["queue_pending"] == []
        production()

    before = production()
    env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/home/slrochford123", "LANG": "C.UTF-8",
           "NODE_ENV": "production", "OTG_ENV": "test", "OTG_AUDIO_ISOLATED_DEV": "1", "OTG_AUDIO_EDITING_ENABLED": "1",
           "OTG_DATA_DIR": str(data), "OTG_WORKER_CONTROL_STORE_DIR": str(data / "worker-control"),
           "OTG_AUDIO_ENGINE_CONFIG": str(engine), "OTG_AUDIO_WORKER_SCRIPT": str(app / "scripts/audio-editing-worker.py"),
           "OTG_MEDIA_GPU_ROUTING": "1", "OTG_VOICE_GPU_LOCK_FILE": config["gpuLock"],
           "PORT": "3310", "HOSTNAME": "127.0.0.1", "NEXT_TELEMETRY_DISABLED": "1", "AUTH_SECRET": secrets.token_hex(48),
           "OTG_SHAWN_PROCESS_PROBE_TARGET": "otg-shawn",
           "OTG_SHAWN_PROCESS_PROBE_IDENTITY_FILE": "/home/slrochford123/.ssh/id_ed25519_otg_cluster_slr_to_shawn",
           "OTG_SHAWN_PROCESS_PROBE_SSH_CONFIG": "/home/slrochford123/.ssh/config"}
    if production_mode:env.update(OTG_ENV="prod",OTG_PRIVATE_RESEARCH_MEDIA="1")
    if admission:env["OTG_MEDIA_ADMISSION_CONFIG"]=admission
    report["environment"]=env["OTG_ENV"]
    cookie = ""

    def api(route, body=None, gpu="auto", raw=None, content_type=None):
        headers = {"Cookie": cookie + "; otg_media_gpu_v1=" + gpu}
        payload = raw if raw is not None else json.dumps(body).encode() if body is not None else None
        if payload is not None:
            headers["Content-Type"] = content_type or "application/json"
        request = urllib.request.Request(base + route, data=payload, headers=headers)
        return urllib.request.urlopen(request, timeout=30)

    def check(name):
        report["checks"].append({"name": name, "passed": True})
        print(name, flush=True)

    def wait_job(session, job):
        for _ in range(100):
            with api("/api/edit-video/audio?session=" + session) as response:
                state = json.load(response)
            match = next((j for j in state["jobs"] if j["id"] == job), None)
            if match and match["status"] in ("completed", "failed", "canceled"):
                if match["status"] != "completed":
                    # Keep exact failure in PRIVATE evidence, never public logs.
                    (root / "failed-job.private.json").write_text(json.dumps(match, indent=2))
                    raise RuntimeError("Audio job failed; inspect private failed-job report")
                return state
            time.sleep(1)
        raise RuntimeError("Audio job did not reach a verified terminal state")

    server = None
    try:
        with (root / "http-server.log").open("xb") as log:
            server = subprocess.Popen([str(node), "server.js"], cwd=app, env=env, stdout=log, stderr=log)
            for _ in range(100):
                if server.poll() is not None:
                    raise RuntimeError("Private QA app failed startup")
                try:
                    with urllib.request.urlopen(base + "/api/healthz", timeout=1) as response:
                        if response.status == 200:
                            break
                except Exception:
                    time.sleep(.2)
            else:
                raise RuntimeError("Private QA startup timed out")
            username = "channelqa_" + secrets.token_hex(5)
            password = secrets.token_urlsafe(32)
            with api("/api/auth/signup", {"username": username, "password": password, "email": username + "@test.invalid"}) as response:
                assert response.status == 200
            with api("/api/auth/login", {"identifier": username, "password": password}) as response:
                cookie = "; ".join(item.split(";")[0] for item in response.headers.get_all("Set-Cookie"))
            with api("/api/app/build") as response:
                identity = json.load(response)
            assert identity["buildVersion"] == json.loads((app / "config/build-history.json").read_text())["current"]
            report["buildVersion"] = identity["buildVersion"]
            check("Authenticated built-app identity on isolated loopback SLR listener")
            with api("/api/edit-video/audio") as response:
                caps = json.load(response)
            assert caps["capabilities"]["pythonReady"] and caps["capabilities"]["enabled"]
            check("Explicit SLR audio runtime survived standalone TEST bootstrap")
            if admission:
                with api("/api/media-gpu") as response:gpu_state=json.load(response)
                assert gpu_state['enabled'] and gpu_state['sharedAdmission']['authorityId']==json.loads(Path(admission).read_text())['authorityId']
                check("Shared physical admission enabled in real deployment environment")
            with api("/api/edit-video/audio", {"action": "new"}) as response:
                session = json.load(response)["session"]["id"]
            video = root / "original-synthetic-test.mp4"
            subprocess.run([config.get("ffmpeg", "ffmpeg"), "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=128x96:rate=24:duration=2",
                            "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "2", str(video)], check=True, timeout=25)
            boundary = "----slr" + secrets.token_hex(12)
            multipart = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"session\"\r\n\r\n{session}\r\n"
                         f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"synthetic.mp4\"\r\nContent-Type: video/mp4\r\n\r\n").encode() + video.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
            with api("/api/edit-video/audio", raw=multipart, content_type="multipart/form-data; boundary=" + boundary) as response:
                imported = json.load(response)
            state = wait_job(session, imported["job"]["id"])
            soundtrack = next(a for a in state["session"]["assets"] if a["origin"] == "original-soundtrack")
            check("API upload and CPU soundtrack extraction in owner-scoped private data")
            report["inference"] = []
            for gpu in ("rtx3090", "rtx5060ti"):
                idle(gpu)
                started = time.monotonic()
                with api("/api/edit-video/audio", {"action": "process", "sessionId": session, "operation": "enhance",
                         "assetId": soundtrack["id"], "params": {"engine": "mossformer", "target": "speech", "strength": .5}, "gpu": gpu}, gpu=gpu) as response:
                    job = json.load(response)["job"]
                assert job["gpu"] == gpu
                state = wait_job(session, job["id"])
                asset = next(j for j in state["jobs"] if j["id"] == job["id"])["assets"][0]
                with api("/api/edit-video/audio?session=" + session + "&asset=" + asset["id"]) as response:
                    contents = response.read()
                assert len(contents) > 48000 and asset["channels"] == 2 and abs(asset["duration"] - 2) < .002
                report["inference"].append({"gpu": gpu, "jobId": job["id"], "seconds": time.monotonic() - started,
                    "bytes": len(contents), "sha256": hashlib.sha256(contents).hexdigest(), "duration": asset["duration"], "channels": asset["channels"]})
                report['inference'][-1]['transport']='restricted-ssh' if config.get('transports',{}).get(gpu,{}).get('protocol')=='slr-audio-v1' else 'native'
                check("Real queued " + gpu + " restoration, session reconciliation and authenticated download")
            if admission:
                import sqlite3
                ledger=Path(json.loads(Path(admission).read_text())['script']).parent/'admission.sqlite'
                for _ in range(20):
                    with sqlite3.connect(ledger.resolve().as_uri()+'?mode=ro',uri=True) as db:remaining=db.execute('SELECT count(*) FROM grants').fetchone()[0]
                    if remaining==0:break
                    time.sleep(.5)
                else:raise RuntimeError("Admission release was not confirmed; authority left intact")
                check("Both terminal GPU reservations released before private QA shutdown")
            report["passed"] = True
    finally:
        if server is not None and server.poll() is None:
            server.send_signal(signal.SIGTERM)
            server.wait(timeout=30)  # Only this explicitly owned QA app.
        after = production()
        report.update(prodBefore=before, prodAfter=after, prodUnchanged=after == before,
                      testChanged=False, appPort=3310, qaAppStopped=server is None or server.poll() is not None)
        if after != before:
            report["passed"] = False
        (root / "http-qualification.json").write_text(json.dumps(report, indent=2))
        print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
