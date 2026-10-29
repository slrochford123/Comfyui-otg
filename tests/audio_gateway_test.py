"""Isolated protocol/security regression tests. No SSH, services, or GPU calls."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import uuid

SOURCE = Path(__file__).resolve().parents[1] / "scripts/audio-editing-gateway.py"
spec = importlib.util.spec_from_file_location("audio_gateway", SOURCE)
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)
client_spec = importlib.util.spec_from_file_location("audio_gateway_client", SOURCE.with_name("audio-editing-restricted-remote.py"))
client = importlib.util.module_from_spec(client_spec)
client_spec.loader.exec_module(client)


class GatewayTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="audio-gateway-qa-")
        self.root = Path(self.temporary.name)
        (self.root / "engines.json").write_text(json.dumps({"localGpu": "rtx3090", "python": sys.executable,
            "verified": {"speech": {"rtx3090": True}}}))
        self.api = gateway.Gateway(self.root)
        self.identifier = str(uuid.uuid4())
        self.api.handle({"action": "create", "id": self.identifier})
        self.job = self.api.job(self.identifier)
        self.data = b"original-source-content"

    def tearDown(self):
        self.temporary.cleanup()

    def upload(self, **changes):
        return self.api.handle({"action": "upload", "id": self.identifier, "name": "source.wav", "offset": 0,
            "data": base64.b64encode(self.data).decode(), **changes})

    def manifest(self, **changes):
        return {"operation": "extract", "gpu": "cpu", "params": {},
            "input": {"name": "source.wav", "bytes": len(self.data), "sha256": hashlib.sha256(self.data).hexdigest()}, **changes}

    def test_probe_has_no_general_file_or_shell_interface(self):
        self.assertEqual(self.api.handle({"action": "probe"})["protocol"], "slr-audio-v1")
        for packet in ({"action": "shell", "command": "id"}, {"action": "probe", "path": "/etc/passwd"},
                       {"action": "cancel", "id": self.identifier, "pid": os.getpid()}):
            with self.assertRaises(ValueError):
                self.api.handle(packet)

    def test_saved_voice_ids_stay_on_authenticated_controller(self):
        job = {"operation": "speech", "gpu": "rtx3090", "params": {"text": "Hello", "voiceId": "private-voice", "characterId": "private-character"}}
        wire = client.wire_manifest(job)
        self.assertEqual(wire["params"], {"text": "Hello"})
        self.assertEqual(job["params"]["voiceId"], "private-voice")

    def test_traversal_and_non_uuid_are_rejected(self):
        for identifier in ("../outside", str(uuid.uuid4()).upper(), "x" * 36):
            with self.assertRaises(ValueError):
                self.api.handle({"action": "create", "id": identifier})
        for name in ("../engines.json", "/etc/passwd", "source.m3u8", "source.wav/../../x", "request.json"):
            with self.assertRaises(ValueError):
                self.upload(name=name)

    def test_symlink_job_is_rejected(self):
        other = str(uuid.uuid4())
        (self.api.jobs / other).symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.api.handle({"action": "create", "id": other})

    def test_symlink_input_is_rejected(self):
        (self.job / "inputs/source.wav").symlink_to(self.root / "engines.json")
        with self.assertRaises(ValueError):
            self.upload()

    def test_input_receipt_and_bounds(self):
        self.assertEqual(self.upload()["bytes"], len(self.data))
        self.assertEqual(self.api.manifest(self.job, self.manifest())["source"], str(self.job / "inputs/source.wav"))
        with self.assertRaises(ValueError):
            self.upload(offset=1)
        with self.assertRaises(ValueError):
            self.api.manifest(self.job, self.manifest(input={"name": "source.wav", "bytes": len(self.data), "sha256": "0" * 64}))
        with self.assertRaises(ValueError):
            self.upload(offset=len(self.data), data=base64.b64encode(b"x" * (gateway.CHUNK + 1)).decode())

    def test_configuration_and_command_injection_are_rejected(self):
        self.upload()
        for changes in ({"python": "/bin/sh"}, {"source": "/etc/passwd"}, {"operation": "mix"},
                        {"params": {"command": "id"}}, {"params": {"start": float("nan")}},
                        {"params": {"length": True}}, {"params": {"engine": "../x"}}, {"gpu": "rtx5060ti"}):
            with self.assertRaises(ValueError):
                self.api.manifest(self.job, self.manifest(**changes))

    def test_unqualified_engine_cannot_start(self):
        with self.assertRaises(ValueError):
            self.api.manifest(self.job, {"operation": "music", "gpu": "rtx3090", "params": {"prompt": "piano", "seconds": 10}})

    def test_cancellation_never_signals_caller_pid(self):
        self.assertTrue(self.api.handle({"action": "cancel", "id": self.identifier})["cancelRequested"])
        self.assertTrue((self.job / "cancel").is_file())
        with self.assertRaises(ValueError):
            self.upload()

    def test_exit_receipt_precedes_completed_status_and_download(self):
        (self.job / "status.json").write_text(json.dumps({"status": "completed", "progress": 100}))
        self.assertEqual(self.api.handle({"action": "status", "id": self.identifier})["state"]["status"], "running")
        with self.assertRaises(ValueError):
            self.api.handle({"action": "result", "id": self.identifier})

    def test_actual_supervisor_seals_and_collects_only_worker_artifacts(self):
        # Tiny CPU fixture proves protocol lifecycle, NOT real model inference.
        (self.root / "audio-editing-worker.py").write_text(
            "import json,sys;from pathlib import Path\nr=Path(sys.argv[1]).parent\n"
            "(r/'out.wav').write_bytes(b'fixture')\n"
            "(r/'result.json').write_text(json.dumps({'assets':[{'file':str(r/'out.wav'),'id':'asset'}]}))\n"
            "(r/'status.json').write_text(json.dumps({'status':'completed','progress':100}))\n")
        self.upload()
        receipt = self.api.handle({"action": "run", "id": self.identifier, "manifest": self.manifest()})
        self.assertEqual(receipt["exitCode"], 0)
        self.assertTrue(self.api.handle({"action": "status", "id": self.identifier})["workerExited"])
        result = self.api.handle({"action": "result", "id": self.identifier})
        self.assertNotIn("file", result["result"]["assets"][0])
        output = self.api.handle({"action": "download", "id": self.identifier, "artifact": "0", "offset": 0})
        self.assertEqual(base64.b64decode(output["data"]), b"fixture")
        for name in ("../worker.log", "/etc/passwd", "-1", "00"):
            with self.assertRaises(ValueError):
                self.api.handle({"action": "download", "id": self.identifier, "artifact": name, "offset": 0})
        with self.assertRaises(ValueError):
            self.api.handle({"action": "run", "id": self.identifier, "manifest": self.manifest()})

    def test_arbitrary_ssh_command_is_denied_before_runtime_load(self):
        for command in ("id", "sh", "slr-audio-v1;id", "", "cat /etc/passwd"):
            result = subprocess.run([sys.executable, str(SOURCE)], input=b'{}\n', capture_output=True,
                                    env={**os.environ, "SSH_ORIGINAL_COMMAND": command})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Only the restricted audio protocol", json.loads(result.stdout)["error"])


if __name__ == "__main__":
    unittest.main()
