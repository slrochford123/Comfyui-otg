"""CPU metadata tests only: separate app DBs share one physical authority."""
import concurrent.futures
import importlib.util
from pathlib import Path
import tempfile
import unittest
import uuid

spec=importlib.util.spec_from_file_location("admission",Path(__file__).resolve().parents[1]/"scripts/media-gpu-admission.py")
admission=importlib.util.module_from_spec(spec)
spec.loader.exec_module(admission)


class Admission(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="shared-media-admission-")
        self.db=Path(self.temp.name)/"admission.sqlite"
        self.owner=str(uuid.uuid4())

    def tearDown(self):self.temp.cleanup()

    def call(self,action="acquire",gpu="rtx3090",owner=None,**kwargs):
        return admission.handle(self.db,{"action":action,"gpu":gpu,"owner":owner or self.owner,**kwargs})

    def test_idempotent_claim_survives_connection_reopen(self):
        first=self.call();second=self.call();self.assertTrue(first["granted"]);self.assertEqual(first,second)

    def test_two_environments_cannot_own_same_card(self):
        self.call();self.assertFalse(self.call(owner=str(uuid.uuid4()))["granted"])
        self.assertTrue(self.call(gpu="rtx5060ti",owner=str(uuid.uuid4()))["granted"])

    def test_old_or_wrong_release_cannot_release_new_generation(self):
        first=self.call();self.assertFalse(self.call("release",token=first["token"],owner=str(uuid.uuid4()))["matched"])
        self.assertTrue(self.call("release",token=first["token"])["matched"])
        second=self.call(owner=str(uuid.uuid4()));self.assertGreater(second["token"],first["token"])
        self.assertFalse(self.call("release",token=first["token"])["matched"])
        self.assertTrue(self.call("status")["busy"])

    def test_atomic_concurrent_claims_have_exactly_one_winner(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(lambda _:self.call(owner=str(uuid.uuid4())),range(4)))
        self.assertEqual(sum(r["granted"] for r in results),1)

    def test_invalid_actions_fields_and_owner_are_rejected(self):
        for packet in ({"action":"shell","gpu":"rtx3090","owner":self.owner},
            {"action":"acquire","gpu":"any","owner":self.owner},
            {"action":"acquire","gpu":"rtx3090","owner":"../x"},
            {"action":"acquire","gpu":"rtx3090","owner":self.owner,"path":"/etc/passwd"}):
            with self.assertRaises(ValueError):admission.handle(self.db,packet)


if __name__=="__main__":unittest.main()
