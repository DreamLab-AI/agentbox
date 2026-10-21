"""Transfer integrity tests; no model downloads or GPU required."""
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('downloader', Path(__file__).resolve().parents[2] / 'skills/comfyui/scripts/download_video_models.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Response(io.BytesIO):
    def __init__(self, body, status=200, headers=None):
        super().__init__(body)
        self.status = status
        self.headers = headers or {}

class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.body = b'verified model contents'
        self.model = dict(repo='publisher/model', revision='a'*40, file='model.safetensors', directory='vae', size=len(self.body), sha256=hashlib.sha256(self.body).hexdigest())
        self.target = self.root / 'vae/model.safetensors'
        self.partial = self.target.with_suffix('.safetensors.part')
        self.target.parent.mkdir()

    def test_resumes_and_atomically_publishes_verified_file(self):
        self.partial.write_bytes(self.body[:8])
        with patch.object(m.urllib.request, 'urlopen', return_value=Response(self.body[8:], 206, {'Content-Range': f'bytes 8-{len(self.body)-1}/{len(self.body)}'})) as request:
            m.download(self.model, self.root)
        self.assertEqual(request.call_args.args[0].get_header('Range'), 'bytes=8-')
        self.assertEqual(self.target.read_bytes(), self.body)
        self.assertFalse(self.partial.exists())

    def test_ignored_range_restarts_without_duplicate_bytes(self):
        self.partial.write_bytes(self.body[:8])
        with patch.object(m.urllib.request, 'urlopen', return_value=Response(self.body)):
            m.download(self.model, self.root)
        self.assertEqual(self.target.read_bytes(), self.body)

    def test_wrong_content_never_replaces_existing_file(self):
        self.target.write_bytes(b'previous content')
        with patch.object(m.urllib.request, 'urlopen', return_value=Response(b'x' * len(self.body))):
            with self.assertRaises(RuntimeError):
                m.download(self.model, self.root, retries=1)
        self.assertEqual(self.target.read_bytes(), b'previous content')
        self.assertFalse(self.partial.exists())

    def test_wrong_range_does_not_append(self):
        self.partial.write_bytes(self.body[:8])
        with patch.object(m.urllib.request, 'urlopen', return_value=Response(self.body[8:], 206, {'Content-Range': f'bytes 0-{len(self.body)-1}/{len(self.body)}'})):
            with self.assertRaises(RuntimeError):
                m.download(self.model, self.root, retries=1)
        self.assertEqual(self.partial.read_bytes(), self.body[:8])
        self.assertFalse(self.target.exists())

    def test_interrupted_transfer_resumes_on_next_call(self):
        class Interrupted(Response):
            def read(inner, size):
                if inner.tell():
                    raise OSError('connection lost')
                return super(Interrupted, inner).read(8)
        with patch.object(m.urllib.request, 'urlopen', return_value=Interrupted(self.body)):
            with self.assertRaises(RuntimeError):
                m.download(self.model, self.root, retries=1)
        self.assertEqual(self.partial.read_bytes(), self.body[:8])
        self.assertFalse(self.target.exists())
        with patch.object(m.urllib.request, 'urlopen', return_value=Response(self.body[8:], 206, {'Content-Range': f'bytes 8-{len(self.body)-1}/{len(self.body)}'})):
            m.download(self.model, self.root)
        self.assertEqual(self.target.read_bytes(), self.body)

    def test_verified_existing_file_skips_network(self):
        self.target.write_bytes(self.body)
        with patch.object(m.urllib.request, 'urlopen') as request:
            m.download(self.model, self.root)
        request.assert_not_called()

    def test_campaign_deduplicates_shared_weights_and_rejects_collisions(self):
        other = dict(self.model, sha256='b'*64)
        with patch.dict(m.PROFILES, {'one': [self.model], 'two': [self.model], 'bad': [other]}):
            self.assertEqual(m.selected_models(['one', 'two']), [self.model])
            with self.assertRaisesRegex(ValueError, 'Conflicting'):
                m.selected_models(['one', 'bad'])

    def test_plan_never_calls_network_or_marks_size_match_verified(self):
        self.target.write_bytes(self.body)
        with patch.dict(m.PROFILES, {'fixture': [self.model]}), patch.object(m.urllib.request, 'urlopen') as request:
            plan = m.provision_plan(['fixture'], self.root)
        request.assert_not_called()
        self.assertEqual(plan['files'][0]['state'], 'size_match_unverified')
        self.assertEqual(plan['download_bytes_remaining_by_size'], 0)

    def test_token_is_not_forwarded_in_redirect_headers(self):
        with patch.dict(m.os.environ, {'HF_TOKEN': 'test-placeholder'}), patch.object(m.urllib.request, 'urlopen', return_value=Response(self.body)) as request:
            m.download(self.model, self.root)
        req = request.call_args.args[0]
        self.assertNotIn('Authorization', req.headers)
        self.assertEqual(req.unredirected_hdrs['Authorization'], 'Bearer test-placeholder')

if __name__ == '__main__':
    unittest.main()
