import unittest

import agentbox_video


class PackageTests(unittest.TestCase):
    def test_merged_mappings(self):
        cm, dm = agentbox_video.NODE_CLASS_MAPPINGS, agentbox_video.NODE_DISPLAY_NAME_MAPPINGS
        self.assertEqual(set(cm), set(dm))
        for name in ("AgentboxSaveLatentVerified", "AgentboxLoadImageVerified", "AgentboxRelayPrepare",
                     "AgentboxTrackMask", "AgentboxRetakePrep"):
            self.assertIn(name, cm)


if __name__ == "__main__":
    unittest.main()
