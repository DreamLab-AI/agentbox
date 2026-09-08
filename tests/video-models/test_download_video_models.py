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

if __name__ == '__main__':
    unittest.main()
