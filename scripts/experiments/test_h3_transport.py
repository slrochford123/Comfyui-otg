"""Offline security and cancellation tests. No SSH, real processes or GPU work."""
import base64
import json
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
import uuid
from unittest.mock import patch
from h3_gateway import Gateway, digest, CHUNK
from h3_remote import authorized, receive_preview
from h3_runner import Job, Cancelled


class H3Transport(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='h3-transport-unit-');self.root=Path(self.temp.name)
        (self.root/'runtime.json').write_text(json.dumps({'environment':'prod','workspace':'h3-nsfw','models':{'prism-pika':{'qualifiedModes':['text','image']}}}))
        self.gateway=Gateway(self.root);self.id=str(uuid.uuid4());self.gateway.handle({'action':'create','id':self.id})
        self.job=self.root/'jobs'/self.id

    def tearDown(self):self.temp.cleanup()

    def test_protocol_never_accepts_paths_shell_config_or_pids(self):
        for packet in [{'action':'shell','command':'anything'},{'action':'cancel','id':self.id,'pid':123},{'action':'create','id':'../../other'},{'action':'upload','id':self.id,'name':'../../private','offset':0,'data':'AA=='}]:
            with self.assertRaises((ValueError,KeyError)):self.gateway.handle(packet)

    def test_saved_job_count_has_no_cap_but_disk_reserve_is_enforced(self):
        for _ in range(501):(self.root/'jobs'/str(uuid.uuid4())).mkdir()
        with patch('h3_gateway.shutil.disk_usage',return_value=type('Disk',(),{'free':100*1024**3})()):
            identifier=str(uuid.uuid4())
            self.assertEqual(self.gateway.handle({'action':'create','id':identifier})['id'],identifier)
        with patch('h3_gateway.shutil.disk_usage',return_value=type('Disk',(),{'free':11*1024**3})()):
            with self.assertRaisesRegex(ValueError,'storage reserve'):self.gateway.handle({'action':'create','id':str(uuid.uuid4())})

    def test_upload_offsets_hashes_and_sealing(self):
        packet={'action':'upload','id':self.id,'name':'0.media','offset':0,'data':base64.b64encode(b'fixture').decode()}
        self.assertEqual(self.gateway.handle(packet)['bytes'],7)
        with self.assertRaises(ValueError):self.gateway.handle(packet)
        payload={'id':self.id,'model':'prism-pika','settings':{'mode':'image','resolution':'0.2','orientation':'landscape','gpu':'rtx3090','recipe':'author','seconds':2,'seed':0,'prompt':'A paper boat.'},'sources':[{'name':'0.media','kind':'image','sha256':digest(self.job/'sources/0.media')}]}
        self.assertEqual(self.gateway.validate(self.job,payload)['remoteLeaseSeconds'],60)
        payload['settings']['gpu']='rtx5060ti'
        with self.assertRaisesRegex(ValueError,'Unqualified'):self.gateway.validate(self.job,payload)
        self.gateway.handle({'action':'cancel','id':self.id})
        with self.assertRaisesRegex(ValueError,'sealed or canceled'):self.gateway.handle(dict(packet,offset=7))

    def test_no_arbitrary_downloads_or_premature_outputs(self):
        with self.assertRaisesRegex(ValueError,'No completed'):self.gateway.handle({'action':'download','id':self.id,'name':'result.mp4','offset':0})
        (self.job/'status.json').write_text(json.dumps({'state':'completed','cleanedUp':True}))
        with self.assertRaisesRegex(ValueError,'Unknown artifact'):self.gateway.handle({'action':'download','id':self.id,'name':'request.json','offset':0})
        (self.job/'result.mp4').symlink_to(self.root/'runtime.json')
        with self.assertRaisesRegex(ValueError,'Invalid artifact'):self.gateway.handle({'action':'download','id':self.id,'name':'result.mp4','offset':0})

    def test_preview_is_fixed_bounded_and_checksum_verified(self):
        (self.job/'preview.mp4').write_bytes(b'bounded-preview')
        preview=self.gateway.handle({'action':'preview','id':self.id})
        with tempfile.TemporaryDirectory(prefix='h3-preview-receiver-') as directory:
            target=Path(directory)
            self.assertTrue(receive_preview(target,preview))
            self.assertEqual((target/'preview.mp4').read_bytes(),b'bounded-preview')
            self.assertFalse(receive_preview(target,dict(preview,sha256='0'*64)))
            self.assertFalse(receive_preview(target,dict(preview,data='invalid-base64')))
            self.assertFalse(receive_preview(target,{'bytes':0}))
            self.assertEqual((target/'preview.mp4').read_bytes(),b'bounded-preview')
        with self.assertRaises(ValueError):self.gateway.handle({'action':'preview','id':self.id,'name':'request.json'})

    def test_optional_unsafe_or_oversize_preview_does_not_fail_render(self):
        file=self.job/'preview.mp4';file.symlink_to(self.root/'runtime.json')
        self.assertEqual(self.gateway.handle({'action':'preview','id':self.id}),{'bytes':0})
        file.unlink();file.write_bytes(b'x'*(CHUNK+1))
        self.assertEqual(self.gateway.handle({'action':'preview','id':self.id}),{'bytes':0})

    def test_controller_checks_current_grant_version(self):
        user=str(uuid.uuid4());request={'authorization':{'userId':user,'version':1}}
        with sqlite3.connect(self.root/'experiments.sqlite') as db:
            db.execute('CREATE TABLE h3_nsfw_access(user_id TEXT,enabled INTEGER,version INTEGER)')
            db.execute('INSERT INTO h3_nsfw_access VALUES(?,1,1)',(user,));db.commit()
            self.assertTrue(authorized(self.job,request))
            db.execute('UPDATE h3_nsfw_access SET enabled=0,version=2');db.commit();self.assertFalse(authorized(self.job,request))
            db.execute('UPDATE h3_nsfw_access SET enabled=1,version=3');db.commit();self.assertFalse(authorized(self.job,request))
        self.assertTrue(authorized(self.job,{}))
        (self.job/'cancel').touch();self.assertFalse(authorized(self.job,{}))

    def test_disconnected_controller_cancels_unprivileged_worker(self):
        job=object.__new__(Job);job.root=self.job;job.cancelled=False;job.request={'remoteLeaseSeconds':60}
        with self.assertRaisesRegex(Cancelled,'disconnected'):job.check_cancel()
        (self.job/'transport-heartbeat').touch();job.check_cancel()
        with patch('h3_runner.time.time',return_value=time.time()+65):
            with self.assertRaisesRegex(Cancelled,'disconnected'):job.check_cancel()


if __name__=='__main__':unittest.main()
