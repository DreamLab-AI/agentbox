#!/usr/bin/env python3
"""
QGIS MCP Tool Bridge - Connects to the nkarasiak/qgis-mcp plugin via TCP.

Uses length-prefixed framing: each message is preceded by a 4-byte big-endian
unsigned int indicating the JSON payload size in bytes. This matches the
qgis_mcp_plugin protocol (nkarasiak/qgis-mcp).

For full MCP integration, use the FastMCP server instead:
  uv run --project /home/devuser/workspace/qgis-mcp src/qgis_mcp/server.py

This file is a lightweight fallback for direct TCP communication.
"""
import sys
import json
import socket
import struct
import os
import logging

logging.basicConfig(
    level=logging.INFO,
    stream=sys.stderr,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("QgisMCPClient")

HEADER_STRUCT = struct.Struct(">I")  # 4-byte big-endian uint32
RECV_CHUNK_SIZE = 65536
MAX_RESPONSE_SIZE = 100 * 1024 * 1024  # 100 MB


class QgisTCPClient:
    """TCP client for qgis_mcp_plugin with length-prefixed framing."""

    def __init__(self, host, port):
        self.host = host
        self.port = int(port)
        self.socket = None

    def connect(self):
        try:
            self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.socket.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            self.socket.settimeout(10)
            self.socket.connect((self.host, self.port))
            return True
        except Exception as e:
            logger.error(f"Error connecting to QGIS at {self.host}:{self.port}: {e}")
            return False

    def disconnect(self):
        if self.socket:
            self.socket.close()
            self.socket = None

    def _recv_exact(self, n):
        """Read exactly n bytes from the socket."""
        if n > MAX_RESPONSE_SIZE:
            raise ValueError(f"Response too large: {n} bytes")
        buf = bytearray(n)
        view = memoryview(buf)
        pos = 0
        while pos < n:
            nbytes = self.socket.recv_into(view[pos:], min(n - pos, RECV_CHUNK_SIZE))
            if nbytes == 0:
                raise ConnectionError("Connection closed")
            pos += nbytes
        return bytes(buf)

    def send_command(self, command):
        """Send a length-prefixed JSON command and receive the response."""
        if not self.socket:
            return {"status": "error", "message": "Not connected to QGIS server"}

        try:
            # Encode and send with length prefix
            payload = json.dumps(command).encode('utf-8')
            header = HEADER_STRUCT.pack(len(payload))
            self.socket.sendall(header + payload)

            # Receive length-prefixed response
            self.socket.settimeout(60)
            header_bytes = self._recv_exact(4)
            msg_len = HEADER_STRUCT.unpack(header_bytes)[0]
            response_bytes = self._recv_exact(msg_len)
            return json.loads(response_bytes.decode('utf-8'))

        except socket.timeout:
            return {"status": "error", "message": "Socket timeout communicating with QGIS"}
        except Exception as e:
            logger.error(f"Error sending/receiving command: {e}")
            return {"status": "error", "message": f"Unexpected error: {e}"}


def ensure_plugin_installed():
    """Check that the qgis_mcp_plugin is symlinked into QGIS plugins directory."""
    plugin_path = os.path.expanduser(
        "~/.local/share/QGIS/QGIS3/profiles/default/python/plugins/qgis_mcp_plugin"
    )
    repo_path = "/home/devuser/workspace/qgis-mcp/qgis_mcp_plugin"

    if os.path.exists(plugin_path):
        return True

    if os.path.exists(repo_path):
        os.makedirs(os.path.dirname(plugin_path), exist_ok=True)
        os.symlink(repo_path, plugin_path)
        logger.info(f"Symlinked plugin: {repo_path} -> {plugin_path}")
        return True

    logger.warning(
        f"Plugin repo not found at {repo_path}. "
        "Clone it: git clone https://github.com/nkarasiak/qgis-mcp /home/devuser/workspace/qgis-mcp"
    )
    return False


def main():
    """Main loop: read JSON from stdin, send to QGIS, print response to stdout."""
    qgis_host = os.environ.get("QGIS_MCP_HOST", os.environ.get("QGIS_HOST", "localhost"))
    qgis_port = int(os.environ.get("QGIS_MCP_PORT", os.environ.get("QGIS_PORT", "9877")))

    ensure_plugin_installed()

    for line in sys.stdin:
        try:
            request = json.loads(line)
            tool_name = request.get('tool')
            params = request.get('params', {})

            qgis_command = {
                "type": tool_name,
                "params": params
            }

            client = QgisTCPClient(qgis_host, qgis_port)
            response = {}
            if client.connect():
                result = client.send_command(qgis_command)
                response['result'] = result
                client.disconnect()
            else:
                response['error'] = f"Failed to connect to QGIS at {qgis_host}:{qgis_port}"

            sys.stdout.write(json.dumps(response) + '\n')
            sys.stdout.flush()

        except json.JSONDecodeError:
            error_response = {"error": "Invalid JSON received"}
            sys.stdout.write(json.dumps(error_response) + '\n')
            sys.stdout.flush()
        except Exception as e:
            error_response = {"error": f"QGIS tool bridge error: {e}"}
            sys.stdout.write(json.dumps(error_response) + '\n')
            sys.stdout.flush()


if __name__ == "__main__":
    main()
