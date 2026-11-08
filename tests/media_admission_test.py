"""CPU metadata tests only: separate app DBs share one physical authority."""
import concurrent.futures
import importlib.util
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest.mock import patch

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

    def test_fifo_metadata_across_environments_and_old_clients(self):
        second=str(uuid.uuid4())
        first_ticket=self.call("enqueue")["ticket"]
        second_ticket=self.call("enqueue",owner=second)["ticket"]
        self.assertFalse(self.call(ticket=second_ticket,owner=second)["granted"])
        self.assertFalse(self.call(owner=str(uuid.uuid4()))["granted"])
        grant=self.call(ticket=first_ticket)
        self.assertTrue(grant["granted"])
        self.call("release",token=grant["token"])
        self.assertTrue(self.call(ticket=second_ticket,owner=second)["granted"])

    def test_expired_waiter_rejoins_at_tail_and_stale_packets_are_fenced(self):
        with patch.object(admission.time,"time",return_value=1000):
            old=self.call("enqueue")["ticket"]
        with patch.object(admission.time,"time",return_value=1200):
            other=str(uuid.uuid4());ahead=self.call("enqueue",owner=other)["ticket"]
            new=self.call("enqueue")["ticket"]
            self.assertGreater(new,ahead)
            self.assertFalse(self.call(ticket=old)["granted"])
            self.assertFalse(self.call("cancel",ticket=old)["matched"])
            self.assertEqual(self.call("enqueue")["ticket"],new)
            self.assertFalse(self.call(ticket=new)["granted"])

    def test_granted_ticket_survives_crash_time_and_cannot_be_canceled(self):
        with patch.object(admission.time,"time",return_value=1000):
            ticket=self.call("enqueue")["ticket"];grant=self.call(ticket=ticket)
        with patch.object(admission.time,"time",return_value=100000):
            self.assertEqual(self.call(ticket=ticket),grant)
            self.assertFalse(self.call("cancel",ticket=ticket)["done"])
            self.assertTrue(self.call("status")["owned"])
            self.assertFalse(self.call(owner=str(uuid.uuid4()))["granted"])

    def test_canceled_or_finished_ticket_does_not_revive_on_retry(self):
        ticket=self.call("enqueue")["ticket"]
        self.assertTrue(self.call("cancel",ticket=ticket)["matched"])
        self.assertEqual(self.call("enqueue")["state"],"canceled")
        self.assertFalse(self.call(ticket=ticket)["granted"])
        self.assertFalse(self.call()["granted"])
        owner=str(uuid.uuid4());ticket=self.call("enqueue",owner=owner)["ticket"]
        grant=self.call(ticket=ticket,owner=owner)
        self.call("release",token=grant["token"],owner=owner)
        self.assertEqual(self.call("enqueue",owner=owner)["state"],"done")
        self.assertFalse(self.call(ticket=ticket,owner=owner)["granted"])

    def test_qualified_flexible_ticket_only_reserves_one_gpu(self):
        first=self.call("enqueue",gpus=["rtx3090","rtx5060ti"])["ticket"]
        other=str(uuid.uuid4());second=self.call("enqueue",gpu="rtx5060ti",owner=other)["ticket"]
        self.assertFalse(self.call(gpu="rtx5060ti",owner=other,ticket=second)["granted"])
        self.assertTrue(self.call(gpu="rtx5060ti",ticket=first)["granted"])
        with self.assertRaises(ValueError):self.call(gpu="rtx3090",ticket=first)

    def test_wrong_card_and_changed_eligibility_rejected(self):
        ticket=self.call("enqueue")["ticket"]
        self.assertFalse(self.call(gpu="rtx5060ti",ticket=ticket)["granted"])
        with self.assertRaises(ValueError):self.call("enqueue",gpus=["rtx3090","rtx5060ti"])

    def test_cancel_claim_race_never_frees_an_accepted_grant(self):
        ticket=self.call("enqueue")["ticket"]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            claim=pool.submit(self.call,ticket=ticket)
            cancel=pool.submit(self.call,"cancel",ticket=ticket)
            granted,canceled=claim.result(),cancel.result()
        self.assertNotEqual(granted["granted"],canceled["matched"])
        self.assertEqual(self.call("status")["busy"],granted["granted"])


if __name__=="__main__":unittest.main()
