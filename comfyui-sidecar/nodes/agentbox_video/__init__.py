"""agentbox_video: ComfyUI custom-node pack (identity, staging, relay, masks, retake).

ComfyUI imports this package from ``custom_nodes/`` and reads
``NODE_CLASS_MAPPINGS`` / ``NODE_DISPLAY_NAME_MAPPINGS``. Each submodule owns
its own mappings; they are merged here. A submodule that is missing or fails to
import is skipped with a logged warning so one bad module never hides the rest.
"""
import importlib
import logging

_log = logging.getLogger("agentbox_video")
_MODULES = ("identity", "staging", "relay", "masks", "retake")

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

for _name in _MODULES:
    try:
        _mod = importlib.import_module(f".{_name}", __name__)
    except Exception as exc:  # noqa: BLE001 - tolerate any failure, report it
        _log.warning("agentbox_video: skipping module %r (%s: %s)", _name, type(exc).__name__, exc)
        continue
    NODE_CLASS_MAPPINGS.update(getattr(_mod, "NODE_CLASS_MAPPINGS", {}))
    NODE_DISPLAY_NAME_MAPPINGS.update(getattr(_mod, "NODE_DISPLAY_NAME_MAPPINGS", {}))

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
