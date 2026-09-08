import copy
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('video_project', Path(__file__).parents[1] / 'scripts/video_project.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


class ProjectTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="video test's ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'source.py').write_text('def hello(): return "hello"\n')
        self.plan = {'schema_version': 1, 'title': 'Hello', 'audience': 'New maintainers', 'repo_root': '.', 'width': 320, 'height': 180, 'fps': 12, 'scenes': [{'id': 'intro', 'kind': 'title', 'duration': 1, 'title': "Hello: 100% 'world'", 'narration': 'Hello there.', 'evidence': ['source.py']}]}

    def test_delivery_refuses_silent_placeholder(self):
        with self.assertRaisesRegex(ValueError, 'requires narration'):
            m.validate(self.plan, self.root, delivery=True)
        m.validate(self.plan, self.root)

    def test_invalid_timing_and_dimensions(self):
        for bad in [float('nan'), float('inf'), -1, 0, True]:
            self.plan['scenes'][0]['duration'] = bad
            with self.assertRaises(ValueError):
                m.validate(self.plan, self.root)
        self.plan['scenes'][0]['duration'] = 1
        self.plan['width'] = 321
        with self.assertRaises(ValueError):
            m.validate(self.plan, self.root)

    def test_evidence_escape_and_missing_assets(self):
        self.plan['scenes'][0]['evidence'] = ['../escape']
        with self.assertRaisesRegex(ValueError, 'source evidence'):
            m.validate(self.plan, self.root)
        self.plan['scenes'][0]['evidence'] = ['source.py']
        self.plan['scenes'][0].update(kind='image', asset='missing.png')
        with self.assertRaisesRegex(ValueError, 'missing asset'):
            m.validate(self.plan, self.root)

    def test_hero_requires_real_provenance(self):
        (self.root / 'clip.mp4').write_bytes(b'x')
        self.plan['scenes'][0].update(kind='video', asset='clip.mp4', role='hero')
        with self.assertRaisesRegex(ValueError, 'model, workflow'):
            m.validate(self.plan, self.root)

    def test_captions_track_scene_timeline(self):
        self.plan['scenes'].append(dict(self.plan['scenes'][0], id='next', duration=2))
        subtitles = m.captions(self.plan)
        self.assertIn('00:00:00,000 --> 00:00:01,000', subtitles)
        self.assertIn('00:00:01,000 --> 00:00:03,000', subtitles)

    def test_rejects_unreadable_caption_rate_and_titles(self):
        self.plan['scenes'][0]['narration'] = 'Many words ' * 300
        with self.assertRaisesRegex(ValueError, 'readability'):
            m.validate(self.plan, self.root)
        self.plan['scenes'][0]['narration'] = 'Hello there.'
        self.plan['scenes'][0]['title'] = 'Long title ' * 100
        with self.assertRaisesRegex(ValueError, 'two lines'):
            m.validate(self.plan, self.root)

    def test_rejects_nonobject_scenes_and_generation(self):
        for bad in ['intro', None, 4, []]:
            self.plan['scenes'] = [bad]
            with self.assertRaisesRegex(ValueError, 'JSON object'):
                m.validate(self.plan, self.root)
        self.setUp()
        for generation in [None, 'model', {}, {'model': 'm'}, {'model': 'm', 'workflow': 'source.py', 'prompt_id': 42}]:
            self.plan['scenes'][0]['generation'] = generation
            with self.assertRaisesRegex(ValueError, 'generation needs'):
                m.validate(self.plan, self.root)

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg is required')
    def test_portrait_caption_stays_inside_rendered_frame(self):
        self.plan.update(width=360, height=640)
        self.plan['scenes'][0]['title'] = 'Portrait'
        self.plan['scenes'][0]['caption'] = 'Exactly fifty-two characters of on-screen caption txt'
        with self.assertRaisesRegex(ValueError, 'caption must fit two lines'):
            m.validate(self.plan, self.root)
        self.plan['scenes'][0]['caption'] = 'A clear message on screen'
        out = self.root / 'portrait'
        m.compose(self.plan, self.root, out, preview=True)
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(out / 'explainer.mp4'), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], check=True, capture_output=True).stdout
        self.assertEqual(len(raw), 360 * 640)
        band = range(540, 640)
        edges = [raw[y * 360 + x] for y in band for x in list(range(0, 8)) + list(range(352, 360))]
        centre = [raw[y * 360 + x] for y in band for x in range(30, 330)]
        self.assertLess(max(edges), 100, 'caption touches frame edge')
        self.assertGreater(max(centre), 200, 'caption text must actually be visible')

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg is required')
    def test_real_multimodal_render(self):
        # Tones are deliberately test fixtures, never a claimed narration delivery.
        m.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', self.root / 'voice.wav'])
        m.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12', '-t', '0.5', '-c:v', 'libx264', self.root / 'clip.mp4'])
        m.run(['ffmpeg', '-v', 'error', '-y', '-i', self.root / 'clip.mp4', '-frames:v', '1', self.root / 'screen.png'])
        self.plan['scenes'][0]['audio'] = 'voice.wav'
        for ident, kind, fields in [('flow', 'diagram', {'nodes': ['User', 'Hello function', 'Response']}), ('screen', 'image', {'asset': 'screen.png'}), ('clip', 'video', {'asset': 'clip.mp4'})]:
            self.plan['scenes'].append(dict(self.plan['scenes'][0], id=ident, kind=kind, **fields))
        (self.root / 'workflow.json').write_text('{"nodes": []}')
        (self.root / 'comfy-receipt.json').write_text('{"prompt_id": "fixture"}')
        self.plan['scenes'][-1]['generation'] = {'model': 'fixture-model', 'workflow': 'workflow.json', 'prompt_id': 'fixture', 'receipt': 'comfy-receipt.json'}
        out = self.root / 'delivery'
        receipt = m.compose(self.plan, self.root, out)
        info = m.probe(out / 'explainer.mp4')
        self.assertEqual({s['codec_type'] for s in info['streams']}, {'video', 'audio', 'subtitle'})
        self.assertAlmostEqual(float(info['format']['duration']), 4, delta=.2)
        self.assertEqual(receipt['status'], 'rendered-needs-editorial-review')
        self.assertIn('source.py', receipt['sources'])
        generation = receipt['generation'][0]
        self.assertEqual(generation['scene_id'], 'clip')
        for field in ('workflow', 'receipt'):
            self.assertEqual(generation[field + '_sha256'], m.sha256_file(Path(generation[field])))
            self.assertEqual(receipt['assets'][generation[field]], generation[field + '_sha256'])
        self.assertEqual(generation['asset_sha256'], m.sha256_file(self.root / 'clip.mp4'))
        m.validate(json.loads((out / 'plan.json').read_text()), out, delivery=True)
        self.assertTrue((out / 'poster.jpg').stat().st_size > 100)
        with self.assertRaisesRegex(ValueError, 'already exists'):
            m.compose(self.plan, self.root, out)
        low_fps = copy.deepcopy(self.plan)
        low_fps['fps'] = 1
        m.compose(low_fps, self.root, self.root / 'low-fps')
        low_fps['scenes'][0]['duration'] = .3
        with self.assertRaisesRegex(ValueError, 'exceeds scene duration'):
            m.validate(low_fps, self.root, delivery=True)
        self.plan['scenes'][0]['duration'] = .1
        with self.assertRaisesRegex(ValueError, 'exceeds scene duration'):
            m.validate(self.plan, self.root, delivery=True)


if __name__ == '__main__':
    unittest.main()
