#!/usr/bin/env python3
"""Convert a ComfyUI UI-format workflow (the frontend's saved .json) to API format.

The frontend does this with ``app.graphToPrompt()``; this is the same mapping done
headlessly against a live server's ``/object_info``, so an agent can adapt a
downloaded workflow without a browser. Standard library only.

Rules, in order:
- Frontend-only nodes (notes, labels) are dropped. Muted nodes (mode 2) are dropped.
  Bypassed nodes (mode 4) are rewired: a consumer of a bypassed node's output is
  connected to that node's first input of the same type, as the frontend does.
- Widget values are assigned to the schema's widget inputs in declaration order
  (required, then optional). A numeric input that the frontend gives a
  ``control_after_generate`` widget (``control_after_generate`` in its options, or
  named seed/noise_seed) consumes one extra slot.
- A linked input wins over its widget value (the slot is still consumed).
- Linked inputs absent from the schema (dynamic sockets such as Bundle's input_N)
  are kept as links.
- Reroute nodes are resolved through, and Mickmumpitz Bundle/UnbundleByName pairs
  are flattened to the links that feed the Bundle.

Anything the converter cannot place raises; a silent mis-mapping would submit a
wrong graph. Always ``comfy_client.py validate`` the result before submitting.
"""
import argparse
import json
from pathlib import Path
import sys
import urllib.request

FRONTEND_ONLY = {"Note", "MarkdownNote", "MickmumpitzLabel", "PrimitiveNode", "Label (rgthree)"}
WIDGET_TYPES = {"INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"}
SEED_NAMES = {"seed", "noise_seed"}
DYNAMIC_COMBO = "COMFY_DYNAMICCOMBO_V3"
# Mickmumpitz-Nodes name-addressed bundles; flattened to direct links (their slot-meta widgets
# are stored in a frontend order that differs from the schema order).
BUNDLE, UNBUNDLE = "Bundle", "UnbundleByName"


class ConversionError(ValueError):
    pass


def _bundle_meta(value):
    """Parse a Mickmumpitz Bundle/UnbundleByName slot-meta widget, or None."""
    try:
        meta = json.loads(value)
    except (TypeError, ValueError):
        return None
    return meta if isinstance(meta, dict) and isinstance(meta.get("sources"), list) else None


def _spec_type(spec):
    kind = spec[0]
    return "COMBO" if isinstance(kind, list) else kind


def assign_widgets(sections, values, prefix=""):
    """Consume ``values`` (a list, mutated) against schema ``sections`` in frontend order.

    Returns ``{api_name: value}``. A v3 dynamic combo consumes its key, then the
    selected option's own widgets, addressed as ``parent.child``.
    """
    assigned = {}
    for section in ("required", "optional"):
        for name, spec in sections.get(section, {}).items():
            if not values:
                return assigned
            options = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
            kind = _spec_type(spec)
            key = prefix + name
            if kind == DYNAMIC_COMBO:
                choice = values.pop(0)
                assigned[key] = choice
                for option in options.get("options", []):
                    if option.get("key") == choice:
                        assigned.update(assign_widgets(option.get("inputs", {}), values, key + "."))
                continue
            if (kind not in WIDGET_TYPES and not options.get("widgetType")) or options.get("forceInput"):
                continue
            assigned[key] = values.pop(0)
            if kind in ("INT", "FLOAT") and (options.get("control_after_generate") or name in SEED_NAMES) and values:
                values.pop(0)  # the frontend's control_after_generate widget ("fixed", "randomize")
            if any(flag.endswith("_upload") and options[flag] for flag in options) and values:
                values.pop(0)  # the upload button widget LoadImage/LoadVideo add after the file combo
    return assigned


def convert(ui, object_info):
    nodes = {str(n["id"]): n for n in ui.get("nodes", [])}
    links = {}
    for link in ui.get("links", []):
        if isinstance(link, dict):
            links[link["id"]] = (str(link["origin_id"]), link["origin_slot"], link.get("type"))
        else:
            links[link[0]] = (str(link[1]), link[2], link[5] if len(link) > 5 else None)

    bundles = {}
    for node in nodes.values():
        if node["type"] == BUNDLE and node.get("mode") not in (2, 4):
            name = next((v for v in node.get("widgets_values") or [] if isinstance(v, str) and _bundle_meta(v) is None), None)
            if name:
                bundles[name.strip()] = node

    def unbundled(node, slot):
        """Map an UnbundleByName output slot to the link feeding the named Bundle's input."""
        strings = [v for v in node.get("widgets_values") or [] if isinstance(v, str)]
        meta = next((m for m in map(_bundle_meta, strings) if m is not None), None)
        bundle = next((bundles[s.strip()] for s in strings if s.strip() in bundles), None)
        if meta is None or bundle is None or slot >= len(meta["sources"]):
            raise ConversionError(f"UnbundleByName {node['id']} cannot be resolved to a Bundle")
        wanted = meta["sources"][slot]
        socket = next((s for s in bundle.get("inputs", []) if s.get("name") == wanted), None)
        return None if socket is None or socket.get("link") is None else socket["link"]

    def source(link_id, want_type=None, depth=0):
        """Follow Reroutes, bypassed nodes and Bundle/Unbundle pairs back to a real (node_id, slot)."""
        if depth > 64:
            raise ConversionError("link cycle through reroute/bypass")
        origin, slot, kind = links[link_id]
        node = nodes.get(origin)
        if node is None:
            raise ConversionError(f"link {link_id} references missing node {origin}")
        if node["type"] == UNBUNDLE:
            upstream = unbundled(node, slot)
            return None if upstream is None else source(upstream, want_type or kind, depth + 1)
        if node["type"] == "Reroute":
            upstream = (node.get("inputs") or [{}])[0].get("link")
            if upstream is None:
                return None
            return source(upstream, want_type or kind, depth + 1)
        if node.get("mode") == 4:
            want = want_type or kind
            for socket in node.get("inputs", []):
                if socket.get("link") is not None and socket.get("type") == want:
                    return source(socket["link"], want, depth + 1)
            return None
        if node.get("mode") == 2:
            return None
        return [origin, slot]

    prompt = {}
    for node_id, node in nodes.items():
        kind = node["type"]
        if kind in FRONTEND_ONLY or kind in ("Reroute", BUNDLE, UNBUNDLE) or node.get("mode") in (2, 4):
            continue
        schema = object_info.get(kind)
        if schema is None:
            raise ConversionError(f"node {node_id} type {kind!r} is not on the server")
        values = node.get("widgets_values")
        if isinstance(values, dict):
            values = list(values.values())
        values = list(values or [])
        inputs = assign_widgets(schema.get("input", {}), values)
        # Trailing frontend-only widget state (an editor's empty scratch value) is tolerated;
        # a plausible parameter the schema failed to place is not.
        if any(isinstance(v, (int, float, str)) and v not in ("", None) for v in values):
            raise ConversionError(f"node {node_id} ({kind}): {len(values)} widget value(s) unplaced: {values[:4]}")
        declared = {name for section in ("required", "optional", "hidden")
                    for name in schema.get("input", {}).get(section, {})}
        for socket in node.get("inputs", []):
            link_id = socket.get("link")
            name = socket.get("name")
            if link_id is None:
                continue
            resolved = source(link_id, socket.get("type"))
            if resolved is not None:
                inputs[name] = resolved
            elif name not in declared:
                inputs.pop(name, None)
        prompt[node_id] = {"class_type": kind, "inputs": inputs,
                           "_meta": {"title": node.get("title") or kind}}
    # A link to a dropped node is a conversion error, not something to submit.
    for node_id, node in prompt.items():
        for name, value in node["inputs"].items():
            if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and value[0] not in prompt:
                raise ConversionError(f"node {node_id}.{name} links to dropped node {value[0]}")
    return prompt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("workflow", type=Path)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--url", help="ComfyUI base URL to read /object_info from")
    source.add_argument("--object-info", type=Path, help="saved /object_info JSON")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    if args.url:
        with urllib.request.urlopen(args.url.rstrip("/") + "/object_info", timeout=120) as response:
            object_info = json.load(response)
    else:
        object_info = json.loads(args.object_info.read_text())
    try:
        prompt = convert(json.loads(args.workflow.read_text()), object_info)
    except ConversionError as error:
        print(json.dumps({"error": str(error)}))
        return 1
    text = json.dumps(prompt, indent=2) + "\n"
    if args.out:
        args.out.write_text(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
