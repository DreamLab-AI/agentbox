import importlib.util
import json
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location("ui_to_api", Path(__file__).parents[1] / "ui_to_api.py")
ui = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ui)

META = json.dumps({"names": ["MODEL", "W"], "types": ["MODEL", "INT"], "sources": ["input_1", "input_2"]})
OBJECT_INFO = {
    "UNETLoader": {"input": {"required": {"unet_name": [["a.safetensors"], {}], "weight_dtype": [["default"], {}]}}},
    "KSampler": {"input": {"required": {"model": ["MODEL", {}], "seed": ["INT", {"control_after_generate": True}],
                                        "steps": ["INT", {}], "width": ["INT", {}]}}},
    "LoadImage": {"input": {"required": {"image": [["x.png"], {"image_upload": True}]}}},
    "SaveVideo": {"input": {"required": {"video": ["VIDEO", {}], "filename_prefix": ["STRING", {}],
                                         "format": ["COMFY_DYNAMICCOMBO_V3", {"options": [
                                             {"key": "auto", "inputs": {"required": {"codec": ["COMFY_DYNAMICCOMBO_V3", {"options": [
                                                 {"key": "h264", "inputs": {"required": {"crf": ["FLOAT", {}]}}}]}]}}}]}]}}},
    "Bundle": {"input": {"required": {"name": ["STRING", {}]}}},
    "UnbundleByName": {"input": {"required": {"source_bundle": ["STRING", {}]}, "hidden": {"bundle": ["BUNDLE"]}}},
    "PrimitiveInt": {"input": {"required": {"value": ["INT", {"control_after_generate": True}]}}},
    "Passthrough": {"input": {"required": {"model": ["MODEL", {}]}}},
}


def workflow(nodes, links):
    return {"nodes": nodes, "links": links}


class ConvertTests(unittest.TestCase):
    def test_widgets_seed_control_upload_and_dynamic_combo(self):
        wf = workflow([
            {"id": 1, "type": "UNETLoader", "widgets_values": ["a.safetensors", "default"]},
            {"id": 2, "type": "KSampler", "inputs": [{"name": "model", "type": "MODEL", "link": 10}],
             "widgets_values": [42, "fixed", 8, 512]},
            {"id": 3, "type": "LoadImage", "widgets_values": ["x.png", "image"]},
            {"id": 4, "type": "SaveVideo", "widgets_values": ["out/v", "auto", "h264", 18]},
            {"id": 5, "type": "MarkdownNote", "widgets_values": ["notes"]},
        ], [[10, 1, 0, 2, 0, "MODEL"]])
        api = ui.convert(wf, OBJECT_INFO)
        self.assertEqual(api["2"]["inputs"], {"seed": 42, "steps": 8, "width": 512, "model": ["1", 0]})
        self.assertEqual(api["3"]["inputs"], {"image": "x.png"})
        self.assertEqual(api["4"]["inputs"], {"filename_prefix": "out/v", "format": "auto",
                                              "format.codec": "h264", "format.codec.crf": 18})
        self.assertNotIn("5", api)

    def test_linked_widget_input_wins_over_its_value(self):
        wf = workflow([
            {"id": 1, "type": "PrimitiveInt", "widgets_values": [1024, "fixed"]},
            {"id": 2, "type": "KSampler", "inputs": [{"name": "width", "type": "INT", "widget": {"name": "width"}, "link": 7}],
             "widgets_values": [0, "fixed", 4, 512]},
        ], [[7, 1, 0, 2, 3, "INT"]])
        self.assertEqual(ui.convert(wf, OBJECT_INFO)["2"]["inputs"]["width"], ["1", 0])

    def test_bundles_are_flattened_to_the_feeding_link(self):
        wf = workflow([
            {"id": 1, "type": "UNETLoader", "widgets_values": ["a.safetensors", "default"]},
            {"id": 2, "type": "Bundle", "widgets_values": ["setup", META, "{}"],
             "inputs": [{"name": "input_1", "type": "MODEL", "link": 1}, {"name": "input_2", "type": "INT", "link": None}]},
            {"id": 3, "type": "UnbundleByName", "widgets_values": [META, "setup"]},
            {"id": 4, "type": "KSampler", "inputs": [{"name": "model", "type": "MODEL", "link": 2}],
             "widgets_values": [0, "fixed", 4, 512]},
        ], [[1, 1, 0, 2, 0, "MODEL"], [2, 3, 0, 4, 0, "MODEL"]])
        api = ui.convert(wf, OBJECT_INFO)
        self.assertEqual(sorted(api), ["1", "4"])
        self.assertEqual(api["4"]["inputs"]["model"], ["1", 0])

    def test_bypassed_node_is_rewired_and_muted_node_dropped(self):
        wf = workflow([
            {"id": 1, "type": "UNETLoader", "widgets_values": ["a.safetensors", "default"]},
            {"id": 2, "type": "Passthrough", "mode": 4, "inputs": [{"name": "model", "type": "MODEL", "link": 1}]},
            {"id": 3, "type": "KSampler", "inputs": [{"name": "model", "type": "MODEL", "link": 2}],
             "widgets_values": [0, "fixed", 4, 512]},
            {"id": 9, "type": "KSampler", "mode": 2, "widgets_values": [0, "fixed", 4, 512]},
        ], [[1, 1, 0, 2, 0, "MODEL"], [2, 2, 0, 3, 0, "MODEL"]])
        api = ui.convert(wf, OBJECT_INFO)
        self.assertEqual(api["3"]["inputs"]["model"], ["1", 0])
        self.assertNotIn("2", api)
        self.assertNotIn("9", api)

    def test_errors_are_loud(self):
        unknown = workflow([{"id": 1, "type": "NotInstalled", "widgets_values": []}], [])
        with self.assertRaisesRegex(ui.ConversionError, "not on the server"):
            ui.convert(unknown, OBJECT_INFO)
        extra = workflow([{"id": 1, "type": "UNETLoader", "widgets_values": ["a.safetensors", "default", "surprise"]}], [])
        with self.assertRaisesRegex(ui.ConversionError, "unplaced"):
            ui.convert(extra, OBJECT_INFO)


if __name__ == "__main__":
    unittest.main()
