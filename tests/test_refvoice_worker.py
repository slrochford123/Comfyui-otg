"""Exercise the real dispatch function with a fake runner, never CUDA or models."""
import ast
import json
import os
import tempfile
import unittest
from pathlib import Path


class RefVoiceWorkerTest(unittest.TestCase):
    def setup_engine(self, engine, source=None):
        tree = ast.parse(Path("scripts/audio-editing-worker.py").read_text())
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "ref_voice_design")
        self.temp = tempfile.TemporaryDirectory(prefix="refvoice-worker-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.commands = []
        namespace = {"ROOT": self.root, "os": os,
                     "JOB": {"gpu": "rtx3090", "source": source, "params": {"voiceDesignEngine": engine, "text": "Hello there", "description": "Warm", "seed": 23}},
                     "CONFIG": {"refVoiceRuntime": {"engine": engine, "model": "/installed/model", "root": "/installed/root", "python": "/installed/python", "bridge": "/installed/bridge.py"}},
                     "gpu_ready": lambda memory: self.assertEqual(memory, 12000),
                     "atomic": lambda file, payload: file.write_text(json.dumps(payload)),
                     "status": lambda **kwargs: None, "run": lambda args, **kwargs: self.commands.append((args, kwargs)),
                     "asset": lambda *args, **kwargs: None}
        exec(compile(ast.Module(body=[node], type_ignores=[]), "real-worker-function", "exec"), namespace)
        return namespace["ref_voice_design"]

    def test_qwen_uses_installed_offline_engine_and_preserves_seed(self):
        result = self.setup_engine("qwen3")()
        self.assertEqual(result, {"engine": "qwen3", "seed": 23})
        self.assertEqual(self.commands[0][0][:2], ["/installed/python", "/installed/bridge.py"])
        self.assertEqual(self.commands[0][1]["env"]["HF_HUB_OFFLINE"], "1")
        params = json.loads((self.root / "voice-design-params.json").read_text())
        self.assertEqual(params["qwen_instruction"], "Warm")
        self.assertEqual(params["request_seed"], 23)

    def test_cosy_is_rejected(self):
        run = self.setup_engine("cosy")
        with self.assertRaisesRegex(ValueError, "No verified"):
            run()
        self.assertEqual(self.commands, [])

    def test_auk_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "No verified"):
            self.setup_engine("auk")()
        self.assertEqual(self.commands, [])

    def test_h3_cannot_silently_fall_back_to_tts(self):
        run = self.setup_engine("h3")
        with self.assertRaisesRegex(ValueError, "No verified"):
            run()
        self.assertEqual(self.commands, [])


if __name__ == "__main__":
    unittest.main()
