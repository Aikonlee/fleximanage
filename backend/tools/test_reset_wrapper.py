import importlib.machinery
import importlib.util
import pathlib
import unittest
from unittest.mock import Mock

SCRIPT = pathlib.Path('/usr/local/sbin/fleximanage-reset-password')
if not SCRIPT.exists():
    SCRIPT = pathlib.Path(__file__).with_name('fleximanage-reset-password')
loader = importlib.machinery.SourceFileLoader('reset_wrapper', str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
module = importlib.util.module_from_spec(spec)
loader.exec_module(module)


class ResetWrapperTests(unittest.TestCase):
    def test_mismatched_passwords_never_invoke_node(self):
        getpass = Mock(side_effect=['first-long-passphrase', 'different-long-passphrase'])
        runner = Mock()
        with self.assertRaisesRegex(ValueError, 'do not match'):
            module.run('owner@example.com', getpass_fn=getpass, run_fn=runner)
        runner.assert_not_called()

    def test_password_is_only_sent_on_stdin(self):
        getpass = Mock(side_effect=['strong-recovery-passphrase', 'strong-recovery-passphrase'])
        runner = Mock(return_value=Mock(returncode=0))
        module.run('owner@example.com', getpass_fn=getpass, run_fn=runner)
        args, kwargs = runner.call_args
        self.assertNotIn('strong-recovery-passphrase', repr(args))
        self.assertEqual(kwargs['input'], 'strong-recovery-passphrase\n')
        self.assertTrue(kwargs['capture_output'])


if __name__ == '__main__':
    unittest.main()
