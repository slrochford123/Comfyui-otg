"""Exercise the real wait function without importing GPU/model dependencies."""
import ast
import argparse
from pathlib import Path
import types
import unittest
from unittest.mock import Mock

SCRIPT = Path(__file__).resolve().parents[1] / "linux/otg-character-indextts2-dataset-worker.py"

class WaitTests(unittest.TestCase):
    def setup_function(self, active, free, monotonic):
        source = ast.parse(SCRIPT.read_text())
        node = next(n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == "wait_for_free_vram")
        node.returns = None
        for parameter in node.args.args:
            parameter.annotation = None
        env = {"assert_job_active": active, "free_vram_mib": Mock(return_value=free),
               "checkpoint_job": Mock(), "log": Mock(), "WorkerError": RuntimeError,
               "time": types.SimpleNamespace(monotonic=Mock(side_effect=monotonic), sleep=Mock())}
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(SCRIPT), "exec"), env)
        return env

    def test_cancel_releases_wait_before_memory_probe(self):
        active = Mock(side_effect=RuntimeError("QA job canceled"))
        env = self.setup_function(active, 10000, [0])
        with self.assertRaisesRegex(RuntimeError, "canceled"):
            env["wait_for_free_vram"](argparse.Namespace(vram_wait_seconds=180, min_free_vram_mib=16384), {}, "qa-job", {}, 1)
        env["free_vram_mib"].assert_not_called()
        env["time"].sleep.assert_not_called()

    def test_reports_actual_resource_shortage_before_timeout(self):
        env = self.setup_function(Mock(), 10111, [0, 181])
        with self.assertRaisesRegex(RuntimeError, "10111"):
            env["wait_for_free_vram"](argparse.Namespace(vram_wait_seconds=180, min_free_vram_mib=16384), {}, "qa-job", {}, 1)
        call = env["checkpoint_job"].call_args
        self.assertIn("10111 MiB free", call.args[5])
        self.assertEqual(call.args[6], "waiting_for_vram")

if __name__ == "__main__":
    unittest.main()
