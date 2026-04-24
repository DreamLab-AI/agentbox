"""
tests/tui/test_tui_helpers.py

pytest coverage for scripts/tui-read-manifest.py and scripts/tui-write-manifest.py.

Organised into four groups:
  A. Round-trip (write → read → assert structural equivalence)
  B. Error paths (bad argv, malformed TOML, unwritable path, empty state)
  C. Schema-compat (written TOML passes agentbox-config-validate.js exit 0)
  D. Individual field contracts
"""

import json
import os
import pathlib
import stat
import subprocess
import sys
import tomllib

import pytest

# ─── Paths ────────────────────────────────────────────────────────────────────

ROOT = pathlib.Path(__file__).resolve().parents[2]
WRITE_SCRIPT  = ROOT / "scripts" / "tui-write-manifest.py"
READ_SCRIPT   = ROOT / "scripts" / "tui-read-manifest.py"
VALIDATE_JS   = ROOT / "scripts" / "agentbox-config-validate.js"
FIXTURES      = pathlib.Path(__file__).parent / "fixtures"

PYTHON = sys.executable


# ─── Helpers ──────────────────────────────────────────────────────────────────

def run_write(state: dict, toml_path: pathlib.Path) -> subprocess.CompletedProcess:
    """Run tui-write-manifest.py: state dict → TOML file."""
    state_file = toml_path.parent / (toml_path.stem + ".state.json")
    state_file.write_text(json.dumps(state), encoding="utf-8")
    result = subprocess.run(
        [PYTHON, str(WRITE_SCRIPT), str(state_file), str(toml_path)],
        capture_output=True,
        text=True,
    )
    state_file.unlink(missing_ok=True)
    return result


def run_read(toml_path: pathlib.Path, json_path: pathlib.Path) -> subprocess.CompletedProcess:
    """Run tui-read-manifest.py: TOML file → JSON state file."""
    return subprocess.run(
        [PYTHON, str(READ_SCRIPT), str(toml_path), str(json_path)],
        capture_output=True,
        text=True,
    )


def validate_toml(toml_path: pathlib.Path) -> subprocess.CompletedProcess:
    """Run agentbox-config-validate.js against a TOML path."""
    return subprocess.run(
        ["node", str(VALIDATE_JS), str(toml_path)],
        capture_output=True,
        text=True,
        cwd=str(ROOT),
    )


# ─── Minimal valid state ──────────────────────────────────────────────────────

MINIMAL_STATE: dict = {
    "federation.mode": "standalone",
    "federation.external_url": "",
    "adapters.beads":        "local-sqlite",
    "adapters.pods":         "local-jss",
    "adapters.memory":       "embedded-ruvector",
    "adapters.events":       "local-jsonl",
    "adapters.orchestrator": "local-process-manager",
    "gpu.backend": "none",
    "desktop.enabled":    False,
    "desktop.stack":      "hyprland-wayland",
    "desktop.resolution": "1920x1080",
    "toolchains.claude":          True,
    "toolchains.claude_code":     False,
    "toolchains.ruflo":           True,
    "toolchains.claude_flow":     True,
    "toolchains.agentic_qe":      True,
    "toolchains.nagual_qe":       True,
    "toolchains.gemini_cli":      False,
    "toolchains.code_server":     False,
    "toolchains.codebase_memory": True,
    "toolchains.rust":            True,
    "toolchains.cuda":            False,
    "skills.browser.agent_browser": True,
    "skills.browser.playwright":    True,
    "skills.browser.qe_browser":    False,
    "skills.media.ffmpeg":            True,
    "skills.media.imagemagick":       True,
    "skills.media.comfyui_builtin":   False,
    "skills.spatial_and_3d.blender":            False,
    "skills.spatial_and_3d.qgis":               False,
    "skills.spatial_and_3d.gaussian_splatting": False,
    "skills.data_science.pytorch": False,
    "skills.data_science.jupyter": False,
    "skills.docs.latex":          True,
    "skills.docs.mermaid":        True,
    "skills.docs.report_builder": True,
    "skills.ontology.enabled": False,
    "providers.anthropic.enabled":  False,
    "providers.openai.enabled":     False,
    "providers.gemini.enabled":     False,
    "providers.deepseek.enabled":   False,
    "providers.perplexity.enabled": False,
    "providers.openrouter.enabled": False,
    "providers.context7.enabled":   False,
    "providers.brave.enabled":      False,
    "providers.github.enabled":     False,
    "providers.zai.enabled":        False,
    "observability.metrics_port":  "9091",
    "observability.otlp_endpoint": "",
    "observability.log_level":     "info",
    "integrations.ragflow.enabled":                False,
    "integrations.comfyui_external.enabled":       False,
    "integrations.comfyui_external.url":           "http://comfyui:8188",
    "integrations.comfyui_external.ws_url":        "ws://comfyui:8188/ws",
    "integrations.ruvector_external.enabled":      False,
    "integrations.ruvector_external.conninfo":     "",
    "sovereign_mesh.enabled":              True,
    "sovereign_mesh.solid_pod":            True,
    "sovereign_mesh.nostr_bridge":         True,
    "sovereign_mesh.https_bridge":         False,
    "sovereign_mesh.publish_agent_events": False,
    "sovereign_mesh.telegram_mirror":      False,
    "sovereign_mesh.jss_rust_backend":     False,
}


# ═════════════════════════════════════════════════════════════════════════════
# A. Round-trip tests
# ═════════════════════════════════════════════════════════════════════════════

class TestRoundTrip:
    """Write a state dict → TOML → read back → assert structural equivalence."""

    def test_roundtrip_minimal_state(self, tmp_path):
        """All-default state survives a full write→read cycle unchanged."""
        toml_file = tmp_path / "out.toml"
        state_out = tmp_path / "state_out.json"

        assert run_write(MINIMAL_STATE, toml_file).returncode == 0
        assert run_read(toml_file, state_out).returncode == 0

        recovered = json.loads(state_out.read_text())

        # All boolean fields must survive as bools (not strings)
        bool_fields = [k for k, v in MINIMAL_STATE.items() if isinstance(v, bool)]
        for field in bool_fields:
            assert recovered[field] == MINIMAL_STATE[field], (
                f"{field}: expected {MINIMAL_STATE[field]!r}, got {recovered[field]!r}"
            )

        # String fields
        assert recovered["federation.mode"] == "standalone"
        assert recovered["adapters.beads"] == "local-sqlite"
        assert recovered["gpu.backend"] == "none"
        assert recovered["observability.log_level"] == "info"

    def test_roundtrip_desktop_enabled(self, tmp_path):
        """desktop.enabled=True round-trips."""
        state = {**MINIMAL_STATE, "desktop.enabled": True, "desktop.resolution": "2560x1440"}
        toml_file = tmp_path / "out.toml"
        state_out = tmp_path / "state_out.json"

        assert run_write(state, toml_file).returncode == 0
        assert run_read(toml_file, state_out).returncode == 0

        recovered = json.loads(state_out.read_text())
        assert recovered["desktop.enabled"] is True
        assert recovered["desktop.resolution"] == "2560x1440"

    def test_roundtrip_federation_client_with_url(self, tmp_path):
        """federation.mode=client with external_url round-trips."""
        state = {**MINIMAL_STATE,
                 "federation.mode": "client",
                 "federation.external_url": "https://mesh.example.com",
                 "adapters.beads": "external"}
        toml_file = tmp_path / "out.toml"
        state_out = tmp_path / "state_out.json"

        assert run_write(state, toml_file).returncode == 0
        assert run_read(toml_file, state_out).returncode == 0

        recovered = json.loads(state_out.read_text())
        assert recovered["federation.mode"] == "client"
        assert recovered["federation.external_url"] == "https://mesh.example.com"

    def test_roundtrip_observability_port_int_string(self, tmp_path):
        """observability.metrics_port stored as string, recovered as string."""
        state = {**MINIMAL_STATE, "observability.metrics_port": "9099"}
        toml_file = tmp_path / "out.toml"
        state_out = tmp_path / "state_out.json"

        assert run_write(state, toml_file).returncode == 0
        assert run_read(toml_file, state_out).returncode == 0

        recovered = json.loads(state_out.read_text())
        # read script coerces to str via str(g(...))
        assert recovered["observability.metrics_port"] == "9099"

    def test_roundtrip_comfyui_external_enabled(self, tmp_path):
        """integrations.comfyui_external enabled block round-trips."""
        state = {**MINIMAL_STATE,
                 "integrations.comfyui_external.enabled": True,
                 "integrations.comfyui_external.url":    "http://mycomfy:9000",
                 "integrations.comfyui_external.ws_url": "ws://mycomfy:9000/ws"}
        toml_file = tmp_path / "out.toml"
        state_out = tmp_path / "state_out.json"

        assert run_write(state, toml_file).returncode == 0
        assert run_read(toml_file, state_out).returncode == 0

        recovered = json.loads(state_out.read_text())
        assert recovered["integrations.comfyui_external.enabled"] is True
        assert recovered["integrations.comfyui_external.url"] == "http://mycomfy:9000"


# ═════════════════════════════════════════════════════════════════════════════
# B. Error paths
# ═════════════════════════════════════════════════════════════════════════════

class TestErrorPaths:

    def test_read_missing_argv_exits_with_error(self):
        """tui-read-manifest.py with no args raises IndexError → non-zero exit."""
        result = subprocess.run(
            [PYTHON, str(READ_SCRIPT)],
            capture_output=True, text=True,
        )
        assert result.returncode != 0

    def test_write_missing_argv_exits_with_error(self):
        """tui-write-manifest.py with no args raises IndexError → non-zero exit."""
        result = subprocess.run(
            [PYTHON, str(WRITE_SCRIPT)],
            capture_output=True, text=True,
        )
        assert result.returncode != 0

    def test_read_malformed_toml_exits_nonzero(self, tmp_path):
        """Malformed TOML causes tomllib.TOMLDecodeError → non-zero exit + stderr."""
        bad_toml = tmp_path / "bad.toml"
        bad_toml.write_text("[broken\nnot = valid toml ]]", encoding="utf-8")
        state_out = tmp_path / "state.json"

        result = subprocess.run(
            [PYTHON, str(READ_SCRIPT), str(bad_toml), str(state_out)],
            capture_output=True, text=True,
        )
        assert result.returncode != 0
        # stderr should have something
        assert len(result.stderr) > 0 or len(result.stdout) > 0

    def test_write_malformed_json_state_exits_nonzero(self, tmp_path):
        """tui-write-manifest.py given invalid JSON state exits non-zero."""
        bad_state = tmp_path / "bad.json"
        bad_state.write_text("{ not valid json", encoding="utf-8")
        out_toml = tmp_path / "out.toml"

        result = subprocess.run(
            [PYTHON, str(WRITE_SCRIPT), str(bad_state), str(out_toml)],
            capture_output=True, text=True,
        )
        assert result.returncode != 0

    @pytest.mark.skipif(os.getuid() == 0, reason="root bypasses permission checks")
    def test_write_unwritable_output_path_exits_nonzero(self, tmp_path):
        """Writing to a read-only directory exits non-zero."""
        locked_dir = tmp_path / "locked"
        locked_dir.mkdir()
        locked_dir.chmod(stat.S_IRUSR | stat.S_IXUSR)  # no write

        state_file = tmp_path / "state.json"
        state_file.write_text(json.dumps(MINIMAL_STATE), encoding="utf-8")
        out_toml = locked_dir / "out.toml"

        result = subprocess.run(
            [PYTHON, str(WRITE_SCRIPT), str(state_file), str(out_toml)],
            capture_output=True, text=True,
        )
        locked_dir.chmod(stat.S_IRWXU)  # restore for cleanup
        assert result.returncode != 0

    def test_read_missing_toml_produces_default_state(self, tmp_path):
        """tui-read-manifest.py with a non-existent TOML path emits all-default state."""
        missing_toml = tmp_path / "nonexistent.toml"
        state_out    = tmp_path / "state.json"

        result = subprocess.run(
            [PYTHON, str(READ_SCRIPT), str(missing_toml), str(state_out)],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        state = json.loads(state_out.read_text())
        # Reader must still produce a dict with expected keys
        assert state["federation.mode"]     == "standalone"
        assert state["adapters.beads"]      == "local-sqlite"
        assert state["desktop.enabled"]     is False
        assert state["toolchains.claude"]   is True

    def test_read_empty_toml_produces_default_state(self, tmp_path):
        """Empty TOML file produces all-default state (no section → defaults apply)."""
        empty_toml = tmp_path / "empty.toml"
        empty_toml.write_text("", encoding="utf-8")
        state_out = tmp_path / "state.json"

        result = subprocess.run(
            [PYTHON, str(READ_SCRIPT), str(empty_toml), str(state_out)],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        state = json.loads(state_out.read_text())
        assert state["federation.mode"] == "standalone"
        assert state["adapters.beads"]  == "local-sqlite"


# ═════════════════════════════════════════════════════════════════════════════
# C. Schema-compat tests: written TOML must pass agentbox-config-validate.js
# ═════════════════════════════════════════════════════════════════════════════

SCHEMA_FIXTURES = [
    "valid-standalone.toml",
    "valid-full.toml",
    "valid-minimal.toml",
]


@pytest.mark.parametrize("fixture_name", SCHEMA_FIXTURES)
def test_fixture_passes_validator(fixture_name):
    """Known-valid fixture files exit 0 from agentbox-config-validate.js."""
    fixture_path = FIXTURES / fixture_name
    result = validate_toml(fixture_path)
    assert result.returncode == 0, (
        f"{fixture_name} failed validation:\n{result.stderr}"
    )


class TestWrittenOutputPassesValidator:

    def test_minimal_state_write_passes_validator(self, tmp_path):
        """Minimal state → TOML passes the JS validator."""
        toml_file = tmp_path / "out.toml"
        assert run_write(MINIMAL_STATE, toml_file).returncode == 0
        result = validate_toml(toml_file)
        assert result.returncode == 0, f"validator failed:\n{result.stderr}"

    def test_desktop_enabled_write_passes_validator(self, tmp_path):
        """Desktop-enabled state → TOML passes the JS validator."""
        state = {**MINIMAL_STATE, "desktop.enabled": True}
        toml_file = tmp_path / "out.toml"
        assert run_write(state, toml_file).returncode == 0
        result = validate_toml(toml_file)
        assert result.returncode == 0, f"validator failed:\n{result.stderr}"


# ═════════════════════════════════════════════════════════════════════════════
# D. Individual field contracts
# ═════════════════════════════════════════════════════════════════════════════

class TestFieldContracts:

    def test_written_toml_is_valid_toml(self, tmp_path):
        """Output of write script is parseable by Python's tomllib."""
        toml_file = tmp_path / "out.toml"
        assert run_write(MINIMAL_STATE, toml_file).returncode == 0
        with toml_file.open("rb") as fh:
            parsed = tomllib.load(fh)
        assert parsed["core"]["orchestration"] == "ruflo-v3"

    def test_written_toml_has_all_sections(self, tmp_path):
        """Write script always emits [core], [federation], [adapters], [gpu], [desktop]."""
        toml_file = tmp_path / "out.toml"
        assert run_write(MINIMAL_STATE, toml_file).returncode == 0
        with toml_file.open("rb") as fh:
            parsed = tomllib.load(fh)
        for section in ("core", "federation", "adapters", "gpu", "desktop",
                        "sovereign_mesh", "observability", "toolchains"):
            assert section in parsed, f"Section [{section}] missing from written TOML"

    def test_bool_false_written_as_toml_false(self, tmp_path):
        """Boolean False must be written as TOML `false`, not `"false"` string."""
        state = {**MINIMAL_STATE, "desktop.enabled": False}
        toml_file = tmp_path / "out.toml"
        assert run_write(state, toml_file).returncode == 0
        with toml_file.open("rb") as fh:
            parsed = tomllib.load(fh)
        assert parsed["desktop"]["enabled"] is False

    def test_bool_true_written_as_toml_true(self, tmp_path):
        """Boolean True must be written as TOML `true`."""
        state = {**MINIMAL_STATE, "desktop.enabled": True}
        toml_file = tmp_path / "out.toml"
        assert run_write(state, toml_file).returncode == 0
        with toml_file.open("rb") as fh:
            parsed = tomllib.load(fh)
        assert parsed["desktop"]["enabled"] is True

    def test_metrics_port_written_as_integer(self, tmp_path):
        """observability.metrics_port must be a TOML integer, not a string."""
        toml_file = tmp_path / "out.toml"
        assert run_write(MINIMAL_STATE, toml_file).returncode == 0
        with toml_file.open("rb") as fh:
            parsed = tomllib.load(fh)
        assert isinstance(parsed["observability"]["metrics_port"], int)
        assert parsed["observability"]["metrics_port"] == 9091

    def test_invalid_metrics_port_falls_back_to_default(self, tmp_path):
        """Non-integer metrics_port value falls back to 0 without crashing."""
        state = {**MINIMAL_STATE, "observability.metrics_port": "not-a-number"}
        toml_file = tmp_path / "out.toml"
        result = run_write(state, toml_file)
        assert result.returncode == 0
        with toml_file.open("rb") as fh:
            parsed = tomllib.load(fh)
        assert isinstance(parsed["observability"]["metrics_port"], int)
