"""Hermetic tests for adding Activity without disturbing running tmux agents."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class LauncherTests(unittest.TestCase):
    def run_case(self, help_text=None, names='', indices=''):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            # Scripts are interpreted by bash; /tmp may be mounted noexec.
            runtime = Path(tempfile.mkdtemp(prefix='.activity-launcher-', dir=ROOT / 'tests/tui'))
            try:
                tmux = runtime / 'tmux'
                tmux.write_text('''#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TEST_LOG"
if [ "$1" = list-windows ]; then
  case "$*" in
    *window_name*) printf '%s\\n' "$TEST_NAMES";;
    *window_index*) printf '%s\\n' "$TEST_INDICES";;
  esac
fi
''')
                tmux.chmod(0o755)
                safe_path = ':'.join(p for p in os.environ['PATH'].split(':')
                                     if not (Path(p) / 'systemscape').is_file())
                if help_text is not None:
                    binary = runtime / 'systemscape'
                    binary.write_text('#!/usr/bin/env bash\nprintf "%s\\n" "$TEST_HELP"\n')
                    binary.chmod(0o755)
                log = root / 'log'
                env = dict(os.environ, PATH=f'{runtime}:{safe_path}', WORKSPACE=tmp,
                           TEST_LOG=str(log), TEST_NAMES=names, TEST_INDICES=indices,
                           TEST_HELP=help_text or '', AGENTBOX_TMUX_AUTOSTART_DRY_RUN='activity')
                subprocess.run(['bash', str(ROOT / 'config/tmux-autostart.sh')],
                               env=env, check=True, capture_output=True, text=True)
                return log.read_text()
            finally:
                for p in runtime.iterdir():
                    p.unlink()
                runtime.rmdir()

    def test_capable_binary_launches_directly(self):
        out = self.run_case('systemscape --activity')
        self.assertIn('new-window -d -t agentbox:10 -n Activity', out)
        self.assertIn('systemscape --activity', out)
        self.assertNotIn('send-keys', out)

    def test_missing_or_old_binary_explains_rebuild(self):
        for help_text in (None, 'systemscape --demo'):
            with self.subTest(help_text=help_text):
                out = self.run_case(help_text)
                self.assertIn('Rebuild on the host', out)
                self.assertNotIn('systemscape --activity', out)

    def test_existing_activity_is_untouched(self):
        self.assertNotIn('new-window', self.run_case(names='Claude\nActivity'))

    def test_occupied_index_is_preserved(self):
        out = self.run_case('--activity', indices='0\n10')
        self.assertIn('new-window -d -t agentbox: -n Activity', out)
        self.assertNotIn('kill', out)


if __name__ == '__main__':
    unittest.main()
