import importlib.util
from pathlib import Path
import sys
import unittest

SCRIPTS = Path(__file__).parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import narrate


class NarrationTests(unittest.TestCase):
    def test_retimes_from_measured_audio_plus_breathing(self):
        self.assertEqual(narrate.retime(2.1, 'A short line.', 24, .3), 58 / 24)

    def test_readability_sets_floor_and_frame_alignment(self):
        seconds = narrate.retime(.1, 'A complex explanation takes time to read.' * 10, 24, .3)
        self.assertGreaterEqual(seconds, 15)
        self.assertAlmostEqual(seconds * 24, round(seconds * 24))

    def test_refuses_traversal_duplicate_and_missing_narration(self):
        for scenes in [['intro'], [None], [4], [{'id': '../bad', 'narration': 'Hello'}], [{'id': 'a', 'narration': 'x'}, {'id': 'a', 'narration': 'y'}], [{'id': 'a'}]]:
            with self.assertRaises(ValueError):
                narrate.check_script({'schema_version': 1, 'repo_root': '.', 'fps': 24, 'scenes': scenes})


if __name__ == '__main__':
    unittest.main()
