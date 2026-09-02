"""Capture the reference output of every Python site the Rust binary replaces.

PROVENANCE, NOT A LIVE TOOL. This ran once, from the agentbox repo root, at the
commit *before* the Python was deleted; its output is the frozen fixture set in
this directory, which `tests/golden*.rs` asserts the Rust binary reproduces
byte-for-byte.

To regenerate (only if a golden genuinely needs to move — normally a diff here
means the port regressed, not that the fixture is stale):

    git worktree add /tmp/pre-port <the commit that still had the scripts>
    cd /tmp/pre-port && python3 <this file>

The heredoc snippets below are transcribed verbatim from the `python3 -c` and
`python3 - <<PY` sites in config/entrypoint-unified.sh as they stood at that
commit, with the shell variables already substituted.
"""

import json, os, pathlib, subprocess, sys, tempfile, tomllib

ROOT = pathlib.Path("/home/devuser/workspace/wt-manifest/agentbox")
G = ROOT / "services/agentbox-manifest/tests/golden"
G.mkdir(parents=True, exist_ok=True)
LIVE = pathlib.Path("/home/devuser/workspace/project/agentbox/agentbox.toml")
MANIFEST = G / "live-agentbox.toml"
MANIFEST.write_bytes(LIVE.read_bytes())

def w(name, data):
    (G / name).write_bytes(data if isinstance(data, bytes) else data.encode())
    print(f"  {name}: {len(data)} bytes")

# ── 1. tui-read: live manifest + each committed fixture ───────────────────────
srcs = {"live": MANIFEST}
for f in sorted((ROOT / "tests/tui/fixtures").glob("valid-*.toml")):
    srcs[f.stem] = f
for label, src in srcs.items():
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as t:
        out = pathlib.Path(t.name)
    subprocess.run([sys.executable, str(ROOT/"scripts/tui-read-manifest.py"), str(src), str(out)], check=True)
    w(f"tui-read.{label}.json", out.read_bytes())
    out.unlink()

# ── 2. tui-write: verbatim, and merged over the live manifest ────────────────
# pytest is absent here, so lift MINIMAL_STATE out of the test module with ast
# rather than importing it.
import ast, importlib.util
_tree = ast.parse((ROOT/"tests/tui/test_tui_helpers.py").read_text())
MINIMAL = next(ast.literal_eval(n.value) for n in _tree.body
               if isinstance(n, ast.AnnAssign) and getattr(n.target, "id", "") == "MINIMAL_STATE")
w("tui-write.minimal-state.json", json.dumps(MINIMAL, indent=2))

# a richer state: read the live manifest, so every conditional branch fires
live_state = json.loads((G/"tui-read.live.json").read_text())
w("tui-write.live-state.json", json.dumps(live_state, indent=2))

for label, state, existing in [
    ("minimal-verbatim", MINIMAL, None),
    ("live-verbatim", live_state, None),
    ("live-merged", live_state, MANIFEST),
]:
    with tempfile.TemporaryDirectory() as d:
        sp = pathlib.Path(d)/"s.json"; sp.write_text(json.dumps(state))
        op = pathlib.Path(d)/"o.toml"
        argv = [sys.executable, str(ROOT/"scripts/tui-write-manifest.py"), str(sp), str(op)]
        if existing: argv.append(str(existing))
        subprocess.run(argv, check=True)
        w(f"tui-write.{label}.toml", op.read_bytes())

# ── 3. nip98-proxy projection ────────────────────────────────────────────────
NIP98 = r'''
import json, os, sys, tomllib
cfg_path, out_path = sys.argv[1], sys.argv[2]
with open(cfg_path, 'rb') as f:
    cfg = tomllib.load(f)
proxy = (cfg.get('interaction_plane') or {}).get('proxy') or {}
routes = proxy.get('routes') or []
allowed = proxy.get('allowed_pubkeys') or []
if not routes and not allowed:
    if os.path.exists(out_path):
        os.unlink(out_path)
        print('[nip98-proxy] config section absent - removed stale config file')
    sys.exit(0)
out = {'routes': routes, 'allowedPubkeys': allowed}
os.makedirs(os.path.dirname(out_path), exist_ok=True)
with open(out_path, 'w') as f:
    json.dump(out, f, indent=2)
print(f'[nip98-proxy] projected {len(routes)} route(s), {len(allowed)} allowlisted pubkey(s)')
'''
with tempfile.TemporaryDirectory() as d:
    op = pathlib.Path(d)/"sub"/"nip98-proxy-config.json"
    r = subprocess.run([sys.executable, "-c", NIP98, str(MANIFEST), str(op)],
                       capture_output=True, text=True, check=True)
    w("nip98.stdout.txt", r.stdout)
    if op.exists(): w("nip98-proxy-config.json", op.read_bytes())

# ── 4. model-routing: build_config over a routing-enabled manifest ───────────
spec = importlib.util.spec_from_file_location("mr", ROOT/"scripts/model-routing-project.py")
mr = importlib.util.module_from_spec(spec); spec.loader.exec_module(mr)
live = tomllib.loads(MANIFEST.read_text())
mrcfg = dict(live.get("model_routing") or {})
mrcfg["enabled"] = True
w("model-routing.section.json", json.dumps(mrcfg, indent=2))
w("model-routing.llm-config.json", json.dumps(mr.build_config(mrcfg), indent=2) + "\n")

# ── 5. plugin list ───────────────────────────────────────────────────────────
PLUGINS = r'''
import re, sys, tomllib
with open(sys.argv[1], "rb") as f:
    cfg = tomllib.load(f)
pkgs = cfg.get("plugins", {}).get("packages", []) or []
name_re = re.compile(r"^[a-zA-Z0-9@/_.+-]+$")
for entry in pkgs:
    if not entry.get("enabled", False): continue
    name = entry.get("name", ""); source = entry.get("source", "ruflo-git")
    if not name_re.match(name):
        sys.stderr.write(f"[plugin] skipping suspicious name: {name!r}\n"); continue
    if source not in ("ruflo-git", "registry"):
        sys.stderr.write(f"[plugin] skipping unknown source: {source!r} for {name}\n"); continue
    print(f"{name}\t{source}")
'''
r = subprocess.run([sys.executable, "-c", PLUGINS, str(MANIFEST)], capture_output=True, text=True)
w("plugin-list.stdout.txt", r.stdout)

# ── 6. consultants gate ──────────────────────────────────────────────────────
CONS = 'import sys, tomllib\ntry:\n c = tomllib.load(open(sys.argv[1], "rb"))\n print(1 if c.get("consultants", {}).get("enabled", False) else 0)\nexcept Exception:\n print(0)\n'
r = subprocess.run([sys.executable, "-c", CONS, str(MANIFEST)], capture_output=True, text=True)
w("consultants-gate.stdout.txt", r.stdout)

# ── 7. .mcp.json upserts, applied in entrypoint order to one seed file ───────
SEED = {"mcpServers": {"claude-flow": {"command": "node", "args": ["/opt/agentbox/mcp/servers/ruvector-mcp.cjs"],
        "type": "stdio", "env": {"RUVECTOR_PG_CONNINFO": "host=x", "NODE_PATH": "/np"}},
        "ruvector": {"command": "node", "args": ["/home/devuser/.claude/ruvector-mcp.cjs"], "type": "stdio"}}}
w("mcp.seed.json", json.dumps(SEED, indent=2))

with tempfile.TemporaryDirectory() as d:
    f = pathlib.Path(d)/"mcp.json"
    f.write_text(json.dumps(SEED, indent=2))
    steps = [
      ("browser-gpu", "cfg.setdefault('mcpServers', {})['browser-gpu'] = {'type': 'sse', 'url': 'http://browsercontainer:8931/sse'}"),
      ("agentic-qe", """srv = cfg.setdefault('mcpServers', {}).setdefault('agentic-qe', {'command': 'aqe', 'args': ['mcp'], 'type': 'stdio'})
env = srv.setdefault('env', {})
env.update({'AQE_MEMORY_BACKEND': 'memory', 'AQE_VERBOSE': 'false', 'NODE_NO_WARNINGS': '1'})
if '1' == '1' and 'claude-code':
    env['AQE_LLM_PROVIDER'] = 'claude-code'
else:
    env.pop('AQE_LLM_PROVIDER', None)"""),
      ("ontology-bridge", """cfg.setdefault('mcpServers', {})['ontology-bridge'] = {
  'command': 'node', 'args': ['/opt/agentbox/mcp/servers/ontology-bridge.js'], 'type': 'stdio',
  'env': {'VISIONCLAW_API_URL': 'http://visionclaw-server:4000', 'VISIONCLAW_DEV_TOKEN': '',
          'AGENTBOX_PUBKEY': '', 'AGENTBOX_ONTOLOGY_DIRECT_LOAD': 'false',
          'NODE_PATH': '/opt/agentbox/mcp/servers/node_modules'}}"""),
      ("precedent-bridge", """cfg.setdefault('mcpServers', {})['precedent-bridge'] = {
  'command': 'node', 'args': ['/opt/agentbox/mcp/servers/precedent-bridge.js'], 'type': 'stdio',
  'env': {'AGENTBOX_POD_ROOT': '/var/lib/agentbox', 'NODE_PATH': '/opt/agentbox/mcp/servers/node_modules'}}"""),
      ("harness-bridge", """cfg.setdefault('mcpServers', {})['harness-bridge'] = {
  'command': 'node', 'args': ['/opt/agentbox/mcp/servers/harness-bridge.js'], 'type': 'stdio',
  'env': {'NODE_PATH': '/opt/agentbox/mcp/servers/node_modules'}}"""),
      ("email-gateway", """cfg.setdefault('mcpServers', {})['email-gateway'] = {
  'type': 'http', 'url': 'http://email-mcp-gateway:8765/mcp',
  'headers': {'Authorization': 'Bearer ' + 'tok-123'}}"""),
      ("perplexity", """cfg.setdefault('mcpServers', {})['perplexity'] = {
  'command': 'node', 'args': ['/opt/agentbox/mcp/perplexity/node_modules/@perplexity-ai/mcp-server/dist/index.js'],
  'type': 'stdio', 'env': {'PERPLEXITY_API_KEY': 'pk-1'}}"""),
      ("ruvnet-brain", """cfg.setdefault('mcpServers', {})['ruvnet-brain'] = {
  'command': 'node', 'args': ['/opt/agentbox/mcp/ruvnet-brain/server.js'], 'type': 'stdio',
  'env': {'RUVECTOR_PG_CONNINFO': 'host=ruvector-postgres port=5432 dbname=ruvector user=ruvector password=' + 'ruvector',
          'XINFERENCE_ENDPOINT': 'http://xinference:9997', 'EMBEDDING_MODEL': 'bge-small-en-v1.5',
          'RUVNET_BRAIN_NAMESPACE': 'ruvnet-kb', 'NODE_PATH': '/opt/agentbox/mcp/ruvnet-brain/node_modules',
          'NODE_NO_WARNINGS': '1'}}"""),
      ("protect-ns", """cf = cfg.get('mcpServers', {}).get('claude-flow')
if cf is not None:
    env = cf.setdefault('env', {})
    cur = [s.strip() for s in env.get('RUVECTOR_PROTECTED_NAMESPACES', 'governance-precedents').split(',') if s.strip()]
    if 'ruvnet-kb' not in cur:
        cur.append('ruvnet-kb')
        env['RUVECTOR_PROTECTED_NAMESPACES'] = ','.join(cur)
        WRITE = True"""),
    ]
    for label, body in steps:
        code = f"import json\nwith open({str(f)!r}) as fh: cfg = json.load(fh)\n{body}\nwith open({str(f)!r},'w') as fh: json.dump(cfg, fh, indent=2)\n"
        subprocess.run([sys.executable, "-c", code], check=True)
        w(f"mcp.after-{label}.json", f.read_bytes())

# ── 8. de-register the ungoverned fork ───────────────────────────────────────
DEREG = r'''
import json, sys
path = sys.argv[1]
try: cfg = json.load(open(path))
except Exception: sys.exit(0)
servers = cfg.get("mcpServers") or {}
doomed = [k for k, v in servers.items()
          if isinstance(v, dict)
          and any("ruvector-mcp" in str(a) and "/opt/agentbox/" not in str(a)
                  for a in (v.get("args") or []) + [v.get("command") or ""])]
for k in doomed: del servers[k]
if doomed:
    json.dump(cfg, open(path, "w"), indent=2)
    print("  [mcp] De-registered ungoverned ruvector fork: " + ", ".join(doomed) + " (ADR-036 D2)")
'''
with tempfile.TemporaryDirectory() as d:
    f = pathlib.Path(d)/"claude.json"; f.write_text(json.dumps(SEED, indent=2))
    r = subprocess.run([sys.executable, "-c", DEREG, str(f)], capture_output=True, text=True, check=True)
    w("dereg.stdout.txt", r.stdout)
    w("dereg.after.json", f.read_bytes())

# ── 9. plugin registration ───────────────────────────────────────────────────
REG = r'''
import json, datetime, sys
path = sys.argv[1]
try: data = json.load(open(path))
except Exception: sys.exit(0)
data.setdefault("plugins", {})
key = "skill-creator@claude-plugins-official"
if key not in data["plugins"]:
    now = "FROZEN"
    data["plugins"][key] = [{"scope": "user", "installPath": "/ip", "version": "marketplace",
                             "installedAt": now, "lastUpdated": now}]
    with open(path, "w") as f: json.dump(data, f, indent=2)
    print("[bootstrap] Pre-installed skill-creator from claude-plugins-official")
'''
with tempfile.TemporaryDirectory() as d:
    f = pathlib.Path(d)/"ip.json"; f.write_text(json.dumps({"plugins": {"other@mp": []}}, indent=2))
    r = subprocess.run([sys.executable, "-c", REG, str(f)], capture_output=True, text=True, check=True)
    w("plugin-register.stdout.txt", r.stdout)
    w("plugin-register.after.json", f.read_bytes())

# ── 10. provision-agent-stacks ───────────────────────────────────────────────
# Fixed path: the generated settings.json embeds absolute workspace paths, so
# capture and replay must agree on it byte-for-byte.
if True:
    ws = pathlib.Path("/tmp/abm-golden-stacks-ws")
    import shutil; shutil.rmtree(ws, ignore_errors=True); ws.mkdir(parents=True)
    env = dict(os.environ, WORKSPACE=str(ws), SKILLS_TREE="/opt/agentbox/skills",
               AGENTBOX_CONFIG=str(MANIFEST), SHARED_PROJECTS_ROOT="/projects")
    for k in ("ANTHROPIC_API_KEY","OPENAI_API_KEY","OPENAI_DEFAULT_MODEL","RUVECTOR_PORT",
              "RUVECTOR_DATA_DIR","NOSTR_RELAYS","PLAYWRIGHT_TIMEOUT","DISPLAY","SCREENSHOT_DIR",
              "NAGUAL_API_KEY","NAGUAL_BASE_URL","RUST_BACKTRACE","CARGO_HOME","RUSTUP_HOME",
              "PERPLEXITY_API_KEY","GOOGLE_API_KEY","ZAI_API_KEY","ZAI_URL","OPENROUTER_API_KEY",
              "GOOGLE_GEMINI_API_KEY","DEEPSEEK_API_KEY","DEEPSEEK_BASE_URL","GEMMA_BASE_URL","GEMMA_MODEL"):
        env.pop(k, None)
    subprocess.run([sys.executable, str(ROOT/"scripts/provision-agent-stacks.py")], env=env, check=True)
    w("stacks.stack-manifest.json", (ws/".agentbox/stack-manifest.json").read_bytes())
    w("stacks.claude-core.settings.json", (ws/"profiles/claude-core/.claude/settings.json").read_bytes())
    w("stacks.claude-core.README.md", (ws/"profiles/claude-core/README.md").read_bytes())
    w("stacks.claude-core.env", (ws/"profiles/claude-core/.env").read_bytes())
    w("stacks.codex.README.md", (ws/"profiles/codex/README.md").read_bytes())

print("\nGolden capture complete.")
