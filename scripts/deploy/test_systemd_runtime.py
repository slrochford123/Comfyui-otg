import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import ExitStack
import sys

spec = importlib.util.spec_from_file_location('systemd_runtime', Path(__file__).with_name('systemd_runtime.py'))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
NODE = Path('/opt/slr/node22/bin/node')
ENTRY = Path('/opt/slr/test/current/server.js')

def effective(node=NODE, entry=ENTRY):
    return '{ path=' + str(node) + ' ; argv[]=' + str(node) + ' ' + str(entry) + ' ; ignore_errors=no ; }'

class RuntimePrecedenceTests(unittest.TestCase):
    def test_exact_legacy_node20_override_failure_is_prevented(self):
        legacy = ['zz-compat-node22.conf', 'zzzz-story-creator-unified-node20.conf',
                  'zzzzz-test-managed-node20.conf']
        selected = runtime.final_override_name(legacy)
        self.assertGreater(selected, max(legacy))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / legacy[0]).write_text(effective())
            for name in legacy[1:]: (root / name).write_text(effective('/opt/slr/node20/bin/node'))
            self.assertIn('node20', (root / max(legacy)).read_text())
            calls = []
            def run(args):
                calls.append(args)
                if 'show' not in args: return ''
                chosen=max(root.glob('*.conf'), key=lambda p:p.name).read_text()
                if chosen.startswith('{'): return chosen
                start=[line for line in chosen.splitlines() if line.startswith('ExecStart=')][-1]
                argv=start.removeprefix('ExecStart=').split()
                return effective(argv[0],argv[1])
            added = runtime.verified_override(NODE, ENTRY, legacy, root, run)
            self.assertEqual(added.name, selected)
            runtime.assert_exec_start(run(['show']), NODE, ENTRY)
            self.assertEqual(calls[0], ['/usr/bin/systemctl','daemon-reload'])
            self.assertTrue(all('restart' not in x for x in calls))
    def test_later_owner_override_is_also_outsorted(self):
        old = ['zzzzzz-compat-node22.conf', 'zzzzzzzzzz-legacy-node20.conf']
        self.assertGreater(runtime.final_override_name(old), max(old))
    def test_checks_effective_command_after_reload_and_reverts_if_wrong(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); legacy=root/'zzzzz-test-managed-node20.conf'
            legacy.write_text('preserve owner override')
            calls=[]
            def run(args):
                calls.append(args)
                return effective('/opt/node20/bin/node') if 'show' in args else ''
            with self.assertRaisesRegex(ValueError,'effective|Effective'):
                runtime.verified_override(NODE,ENTRY,[str(legacy)],root,run)
            self.assertEqual(list(root.iterdir()),[legacy])
            self.assertEqual(legacy.read_text(),'preserve owner override')
            self.assertEqual(sum('daemon-reload' in x for x in calls),2)
    def test_wrong_script_is_rejected(self):
        with self.assertRaises(ValueError): runtime.assert_exec_start(effective(entry='/opt/old/launch.cjs'),NODE,ENTRY)
    def test_extra_argument_is_rejected(self):
        with self.assertRaises(ValueError): runtime.assert_exec_start(effective(entry=str(ENTRY)+' --other'),NODE,ENTRY)
    def test_multiple_start_commands_are_rejected(self):
        with self.assertRaises(ValueError): runtime.assert_exec_start(effective()+effective(),NODE,ENTRY)
    def test_no_effective_start_is_rejected(self):
        with self.assertRaises(ValueError): runtime.assert_exec_start('',NODE,ENTRY)
    def test_existing_override_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); target=root/runtime.final_override_name([]);target.write_text('existing')
            with self.assertRaises(FileExistsError): runtime.verified_override(NODE,ENTRY,[],root)
            self.assertEqual(target.read_text(),'existing')
    def test_unsupported_command_path_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError): runtime.verified_override('/opt/node;evil',ENTRY,[],directory)
            self.assertEqual(list(Path(directory).iterdir()),[])
    def test_process_binary_and_cwd_are_checked_not_only_health(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); node=root/'node22';node.touch();old=root/'node20';old.touch()
            release=root/'release';release.mkdir();proc=root/'proc';pid=proc/'42';pid.mkdir(parents=True)
            (pid/'exe').symlink_to(node);(pid/'cwd').symlink_to(release)
            runtime.assert_process('42',node,release,proc)
            (pid/'exe').unlink();(pid/'exe').symlink_to(old)
            with self.assertRaisesRegex(ValueError,'Node22 binary'): runtime.assert_process('42',node,release,proc)
    def test_wrong_process_cwd_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);node=root/'node';node.touch();release=root/'release';release.mkdir()
            other=root/'old-release';other.mkdir();pid=root/'42';pid.mkdir()
            (pid/'exe').symlink_to(node);(pid/'cwd').symlink_to(other)
            with self.assertRaisesRegex(ValueError,'CWD'): runtime.assert_process('42',node,release,root)
    def test_activation_source_has_no_node20_or_package_rebuild_fallback(self):
        source=Path(__file__).with_name('activate_test_release.py').read_text()
        self.assertNotIn('v20.20.2',source)
        self.assertNotIn("'npm'",source)
        self.assertIn('assert_process(pid, NODE, candidate)',source)
        self.assertIn('override.unlink()',source)
        self.assertNotIn('otg-prod.service',source)
    def test_post_restart_wrong_runtime_rolls_back_pointer_and_own_override(self):
        module_spec=importlib.util.spec_from_file_location('activation',Path(__file__).with_name('activate_test_release.py'))
        activation=importlib.util.module_from_spec(module_spec)
        with patch.dict(sys.modules,{'systemd_runtime':runtime}): module_spec.loader.exec_module(activation)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);releases=root/'releases';releases.mkdir()
            old=releases/'test3001-old';old.mkdir();candidate=releases/'test3001-new';candidate.mkdir()
            current=root/'current';current.symlink_to(old)
            (candidate/'.next').mkdir();(candidate/'server.js').touch();(candidate/'.next/BUILD_ID').write_text('build')
            environment=root/'env';environment.touch();data=root/'data';data.mkdir()
            (candidate/'.env.local').symlink_to(environment);(candidate/'data').symlink_to(data)
            old_exe=root/'node-old';old_exe.touch();proc=root/'proc';(proc/'111').mkdir(parents=True)
            (proc/'111'/'exe').symlink_to(old_exe)
            override=root/'own.conf';override.touch();legacy=root/'legacy.conf';legacy.write_text('preserve')
            calls=[];restarts=[]
            def run(args,**kwargs):
                calls.append(args)
                if '--version' in args:return 'v22.23.4'
                if 'restart' in args:restarts.append(args);return ''
                if 'MainPID' in args:return '111' if not restarts else ('222' if len(restarts)==1 else '333')
                return ''
            assertions=[]
            def verify(pid,node,cwd):
                assertions.append((pid,node,cwd))
                if cwd==candidate:raise ValueError('wrong Node22 binary after restart')
            real_open=open
            def private_lock(file,*args,**kwargs):
                return real_open(root/'lock' if str(file)=='/run/lock/slr-test-activation.lock' else file,*args,**kwargs)
            with ExitStack() as stack:
                for key,value in {'ROOT':root,'CURRENT':current,'PROC':proc,'EXPECTED_LINKS':{'.env.local':environment,'data':data},'command':run,'assert_process':verify}.items():
                    stack.enter_context(patch.object(activation,key,value))
                stack.enter_context(patch.object(activation.os,'geteuid',return_value=0))
                stack.enter_context(patch.object(activation.socket,'gethostname',return_value='shawn'))
                stack.enter_context(patch.object(activation,'verified_override',return_value=override))
                stack.enter_context(patch.object(activation.time,'monotonic',side_effect=[0,100]))
                stack.enter_context(patch('builtins.open',side_effect=private_lock))
                stack.enter_context(patch.object(sys,'argv',['activate','--expected-current',str(old),'--candidate',str(candidate)]))
                with self.assertRaisesRegex(ValueError,'wrong Node22'):activation.main()
            self.assertEqual(current.resolve(),old)
            self.assertFalse(override.exists());self.assertEqual(legacy.read_text(),'preserve')
            self.assertEqual(len(restarts),2)
            self.assertEqual(assertions[-1],('333',old_exe,old))
            self.assertFalse(any('npm' in str(call) or 'otg-prod.service' in call for call in calls))
    def test_unauthorized_activation_exits_before_service_mutation(self):
        module_spec=importlib.util.spec_from_file_location('activation',Path(__file__).with_name('activate_test_release.py'))
        activation=importlib.util.module_from_spec(module_spec)
        with patch.dict(sys.modules,{'systemd_runtime':runtime}): module_spec.loader.exec_module(activation)
        with patch.object(sys,'argv',['activate','--expected-current','/old','--candidate','/new']),patch.object(activation.os,'geteuid',return_value=1000),patch.object(activation,'command') as run:
            with self.assertRaises(SystemExit):activation.main()
            run.assert_not_called()

if __name__ == '__main__': unittest.main()
