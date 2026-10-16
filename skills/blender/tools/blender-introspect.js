#!/usr/bin/env node
/**
 * blender-introspect.js - read-only API introspection for a live Blender over BlenderMCP.
 *
 * Adapted from the "ask the running Blender before writing a script" practice (the
 * Scenario plugin's blender_api_help tool): the running Blender is the authority on
 * operator signatures, types and enum values, which drift between releases.
 *
 *   node blender-introspect.js version
 *   node blender-introspect.js op mesh.primitive_cube_add     operator arguments, defaults, enums
 *   node blender-introspect.js type Object [prefix]           RNA properties of a bpy.types class
 *   node blender-introspect.js data [objects|materials|...]   bpy.data collection names and counts
 *   node blender-introspect.js enum scene.render.engine       enum items AND whether each value assigns (briefly mutates, then restores)
 *   node blender-introspect.js path context.scene.render      dir() of any bpy.<path> (no calls)
 *
 * Env: BLENDER_HOST (default localhost), BLENDER_PORT (default 9876).
 * Safety: the path/name arguments are validated against a strict identifier pattern before they
 * are placed in Python source; the optional comma-separated extra values for `enum` are not
 * pattern-checked but are JSON-encoded into a Python list literal. The generated code only
 * reads, except `enum`, which assigns every candidate value to test it and restores the
 * original in a finally block; that marks the file modified, may add undo steps and may fire
 * update callbacks whose side effects on dependent properties the restore does not undo, so
 * do not run `enum` on a scene with unsaved work you cannot afford to disturb. Exit status
 * 0 = answered, 1 = error, 2 = Blender not reachable, 3 = request outcome unknown
 * (timeout: re-check scene state before retrying anything that mutates).
 */
const net = require('net');

const HOST = process.env.BLENDER_HOST || 'localhost';
const PORT = parseInt(process.env.BLENDER_PORT || '9876', 10);
const CONNECT_MS = 8000;
const RESPONSE_MS = 30000;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function die(code, msg) { process.stderr.write(msg + '\n'); process.exit(code); }

function validate(value, what) {
  if (!value || !IDENT.test(value)) die(1, `invalid ${what}: ${JSON.stringify(value)} (letters, digits, underscore, dots only)`);
  return value;
}

function pythonFor(cmd, a, b) {
  switch (cmd) {
    case 'version':
      return `import bpy
print("version", bpy.app.version_string)
print("file", bpy.data.filepath or "(unsaved)")
print("scenes", [s.name for s in bpy.data.scenes], "objects", len(bpy.data.objects))
print("engine", bpy.context.scene.render.engine if bpy.context.scene else None)`;
    case 'op': {
      const p = validate(a, 'operator path (e.g. mesh.primitive_cube_add)');
      if (!p.includes('.')) die(1, 'operator path needs module.name, e.g. mesh.primitive_cube_add');
      return `import bpy
mod, name = ${JSON.stringify(p)}.split('.', 1)
op = getattr(getattr(bpy.ops, mod), name)
rna = op.get_rna_type()
print("operator", ${JSON.stringify(p)}, "-", rna.bl_rna.description)
for pr in rna.bl_rna.properties:
    if pr.identifier == 'rna_type': continue
    d = getattr(pr, 'default', None)
    if getattr(pr, 'is_array', False) and getattr(pr, 'array_length', 0): d = tuple(getattr(pr, 'default_array', ()))
    line = f"  {pr.identifier:28s} {pr.type:8s} default={d!r}"
    if pr.type == 'ENUM': line += " items=" + ",".join(i.identifier for i in pr.enum_items)
    print(line)`;
    }
    case 'type': {
      const t = validate(a, 'type name (e.g. Object)');
      const prefix = b ? validate(b, 'prefix') : '';
      return `import bpy
cls = getattr(bpy.types, ${JSON.stringify(t)})
print("type", ${JSON.stringify(t)}, "-", cls.bl_rna.description)
n = 0
for pr in cls.bl_rna.properties:
    if pr.identifier == 'rna_type' or not pr.identifier.startswith(${JSON.stringify(prefix)}): continue
    extra = ("  items=" + ",".join(i.identifier for i in pr.enum_items)) if pr.type == 'ENUM' else ""
    print(f"  {pr.identifier:30s} {pr.type:9s}{'RO ' if pr.is_readonly else '   '}{extra}")
    n += 1
    if n >= 120: print("  ... truncated at 120; pass a prefix"); break`;
    }
    case 'data': {
      const c = a ? validate(a, 'collection (e.g. objects)') : '';
      return `import bpy
c = ${JSON.stringify(c)}
if not c:
    for name in sorted(dir(bpy.data)):
        v = getattr(bpy.data, name, None)
        if hasattr(v, '__len__') and hasattr(v, 'keys') and not name.startswith('_'): print(f"  {name:22s} {len(v)}")
else:
    col = getattr(bpy.data, c)
    names = list(col.keys())
    print(c, len(names)); print(names[:80])`;
    }
    case 'enum': {
      const p = validate(a, 'property path (e.g. scene.render.engine)');
      if (!p.includes('.')) die(1, 'enum path needs owner.prop, e.g. scene.render.engine');
      return `import bpy
owner_path, prop = ${JSON.stringify(p)}.rsplit('.', 1)
head, *rest = owner_path.split('.')
if head == 'scene': obj = bpy.context.scene
elif hasattr(bpy.data, head): obj = getattr(bpy.data, head)
else: obj = getattr(bpy.context, head)
for seg in rest: obj = getattr(obj, seg)
pr = obj.bl_rna.properties[prop]
assert pr.type == 'ENUM', f"{prop} is {pr.type}, not ENUM"
listed = [i.identifier for i in pr.enum_items]
print("current", getattr(obj, prop)); print("listed ", listed)
orig = getattr(obj, prop); candidates = list(dict.fromkeys(listed + ${JSON.stringify(b ? b.split(',') : [])}))
try:
    for v in candidates:
        try: setattr(obj, prop, v); print("assigns", v)
        except Exception as e: print("rejects", v, type(e).__name__)
finally:
    setattr(obj, prop, orig); print("restored", getattr(obj, prop))
print("note: enum item lists can be dynamic; trust assignment over listing")`;
    }
    case 'path': {
      const p = validate(a, 'path under bpy (e.g. context.scene.render)');
      return `import bpy
o = bpy
for seg in ${JSON.stringify(p)}.split('.'): o = getattr(o, seg)
print("type", type(o).__name__)
names = [n for n in dir(o) if not n.startswith('_')]
print(len(names), "public names"); print(", ".join(names[:100]) + (" ..." if len(names) > 100 else ""))`;
    }
    default:
      die(1, 'usage: blender-introspect.js version | op <mod.name> | type <Name> [prefix] | data [collection] | enum <owner.prop> [extra,values] | path <context.x.y>');
  }
}

function send(code) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let buf = ''; let connected = false; let settled = false; let t2;
    const finish = (fn, v) => { if (settled) return; settled = true; clearTimeout(t1); clearTimeout(t2); sock.destroy(); fn(v); };
    const t1 = setTimeout(() => finish(reject, { code: 2, msg: `cannot reach Blender at ${HOST}:${PORT} (timeout); run blender-health.js` }), CONNECT_MS);
    sock.connect(PORT, HOST, () => {
      connected = true; clearTimeout(t1);
      sock.write(JSON.stringify({ type: 'execute_code', params: { code } }));
      t2 = setTimeout(() => finish(reject, { code: 3, msg: 'no response in time: outcome UNKNOWN; check scene state (get_scene_info) before retrying anything that mutates' }), RESPONSE_MS);
    });
    sock.on('data', (d) => { buf += d; try { finish(resolve, JSON.parse(buf)); } catch (_) { /* partial */ } });
    // The proxy accepts and then closes when the sidecar is down: nothing received = unreachable (2), half a reply = unknown (3).
    sock.on('close', () => finish(reject, buf
      ? { code: 3, msg: 'connection closed mid-reply: outcome UNKNOWN; check scene state before retrying anything that mutates' }
      : { code: 2, msg: `Blender at ${HOST}:${PORT} accepted the connection and closed it without replying (sidecar down?); run blender-health.js` }));
    sock.on('error', (e) => finish(reject, { code: connected ? (buf ? 3 : 1) : 2, msg: `socket error: ${e.message}` }));
  });
}

(async () => {
  const [cmd, a, b] = process.argv.slice(2);
  const code = pythonFor(cmd, a, b);
  try {
    const r = await send(code);
    if (r.status === 'error') die(1, `Blender error: ${r.message || JSON.stringify(r)}`);
    const out = r.result && typeof r.result === 'object' ? (r.result.result ?? JSON.stringify(r.result)) : String(r.result ?? '');
    process.stdout.write(String(out).replace(/\n*$/, '\n'));
  } catch (e) { die(e.code || 1, e.msg || String(e)); }
})();
