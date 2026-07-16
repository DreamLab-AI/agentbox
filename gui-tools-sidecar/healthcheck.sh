#!/bin/bash
# Healthy when the X display is up AND both the BlenderMCP socket (9876) and the QGIS MCP
# socket (9877) answer a real command. QGIS is now a real headless PyQGIS server (not the
# old HTTP stub), so it is a genuine health gate — no more false-green.
set -uo pipefail
export DISPLAY=":2"

xdpyinfo -display :2 >/dev/null 2>&1 || { echo "xvfb :2 down"; exit 1; }

# BlenderMCP round-trip: send get_scene_info, expect a JSON reply on 9876.
python3 - <<'PY' || exit 1
import socket, json, sys
try:
    s = socket.create_connection(("127.0.0.1", 9876), timeout=8)
    s.sendall(json.dumps({"type": "get_scene_info", "params": {}}).encode())
    buf = b""
    s.settimeout(8)
    while len(buf) < 4:
        chunk = s.recv(65536)
        if not chunk:
            break
        buf += chunk
        try:
            json.loads(buf.decode()); print("blender ok"); sys.exit(0)
        except Exception:
            continue
    print("blender no/invalid response"); sys.exit(1)
except Exception as e:
    print("blender socket error:", e); sys.exit(1)
PY

# QGIS MCP round-trip: length-prefixed (4-byte big-endian) JSON ping, expect pong on 9877.
python3 - <<'PY' || exit 1
import socket, struct, json, sys
H = struct.Struct(">I")
try:
    s = socket.create_connection(("127.0.0.1", 9877), timeout=8)
    p = json.dumps({"type": "ping"}).encode()
    s.sendall(H.pack(len(p)) + p)
    s.settimeout(8)
    def recvn(n):
        b = b""
        while len(b) < n:
            c = s.recv(n - len(b))
            if not c:
                raise RuntimeError("closed")
            b += c
        return b
    n = H.unpack(recvn(4))[0]
    resp = json.loads(recvn(n).decode())
    if resp.get("status") == "success":
        print("qgis ok"); sys.exit(0)
    print("qgis unexpected:", resp); sys.exit(1)
except Exception as e:
    print("qgis socket error:", e); sys.exit(1)
PY

echo "healthy"
exit 0
