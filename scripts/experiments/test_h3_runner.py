"""Offline worker-safety checks. Never contact a real GPU, process or service."""
import signal
import sqlite3
import tempfile
import uuid
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from h3_runner import Job, Cancelled


class PrivateWorkerSafety(unittest.TestCase):
    def job(self):
        job = object.__new__(Job)
        job.cfg = {'queues': ['http://invalid/image', 'http://invalid/h3'], 'gpuUuid': 'fixture-uuid'}
        job.root = Path('/nonexistent-fixture'); job.cancelled = False
        job.child = None; job.token = None; job.update = Mock()
        return job

    def test_busy_queue_prevents_gpu_probe(self):
        job = self.job()
        with patch('h3_runner.http', return_value={'queue_running': [1], 'queue_pending': []}), patch('h3_runner.run', side_effect=AssertionError('Must not probe/start GPU')):
            self.assertFalse(job.idle())

    def test_unavailable_queue_fails_closed(self):
        with patch('h3_runner.http', side_effect=OSError('Unavailable')):
            with self.assertRaises(OSError): self.job().idle()

    def test_cancel_flag_is_checked_without_signalling_other_processes(self):
        job = self.job(); job.cancelled = True
        with patch('h3_runner.os.killpg', side_effect=AssertionError('No process signal yet')):
            with self.assertRaises(Cancelled): job.check_cancel()

    def test_cleanup_stops_only_owned_process_before_fenced_release(self):
        job = self.job(); job.token = 'private-token'
        job.child = Mock(pid=123456); job.child.poll.return_value = None
        events = []
        job.child.wait.side_effect = lambda **kwargs: events.append('wait')
        job.admission = Mock(side_effect=lambda action: events.append(action) or {'matched': True})
        with patch('h3_runner.os.killpg', side_effect=lambda pid, sig: events.append((pid, sig))): job.cleanup()
        self.assertEqual(events, [(123456, signal.SIGTERM), 'wait', 'release'])
        self.assertIsNone(job.token); job.update.assert_called_once_with(cleanedUp=True)

    def test_unconfirmed_release_never_claims_cleanup(self):
        job = self.job(); job.token = 'private-token'; job.admission = Mock(return_value={'matched': False})
        with self.assertRaisesRegex(RuntimeError, 'not confirmed'): job.cleanup()
        job.update.assert_not_called(); self.assertEqual(job.token, 'private-token')

    def test_already_exited_worker_is_not_signalled(self):
        job = self.job(); job.child = Mock(); job.child.poll.return_value = 0
        with patch('h3_runner.os.killpg', side_effect=AssertionError('Exited worker must not be signalled')): job.cleanup()
        job.update.assert_called_once_with(cleanedUp=True)

    def test_revocation_and_reapproval_do_not_revive_old_jobs(self):
        with tempfile.TemporaryDirectory(prefix='slr-permission-fixture-') as root:
            job = self.job(); job.root = Path(root)/'jobs'/str(uuid.uuid4())
            user = str(uuid.uuid4()); job.request = {'authorization': {'userId': user, 'version': 1}}
            db = sqlite3.connect(Path(root)/'experiments.sqlite')
            try:
                db.execute('CREATE TABLE h3_nsfw_access(user_id TEXT,enabled INTEGER,version INTEGER)')
                db.execute('INSERT INTO h3_nsfw_access VALUES(?,1,1)',(user,)); db.commit()
                job.check_cancel()
                db.execute('UPDATE h3_nsfw_access SET enabled=0,version=2'); db.commit()
                with self.assertRaisesRegex(Cancelled,'revoked'): job.check_cancel()
                db.execute('UPDATE h3_nsfw_access SET enabled=1,version=3'); db.commit()
                with self.assertRaises(Cancelled): job.check_cancel()
                job.request['authorization']['version'] = 3
                job.check_cancel()
                db.execute('DELETE FROM h3_nsfw_access'); db.commit()
                with self.assertRaises(Cancelled): job.check_cancel()
            finally: db.close()

    def test_missing_permission_database_fails_closed(self):
        with tempfile.TemporaryDirectory(prefix='slr-permission-fixture-') as root:
            job = self.job(); job.root = Path(root)/'jobs'/str(uuid.uuid4())
            job.request = {'authorization': {'userId': str(uuid.uuid4()), 'version': 1}}
            with self.assertRaisesRegex(Cancelled,'could not be verified'): job.check_cancel()
            self.assertFalse((Path(root)/'experiments.sqlite').exists())


if __name__ == '__main__': unittest.main()
