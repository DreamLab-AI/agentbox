# lib/agentbox-mcp.nix
#
# Nix derivation for `agentbox-mcp` — one rmcp-based multi-tool MCP binary that
# replaces three thin Python FastMCP servers:
#
#   agentbox-mcp imagemagick         <- skills/imagemagick/mcp-server/server.py
#   agentbox-mcp web-summary         <- skills/web-summary/mcp-server/server.py
#   agentbox-mcp gemini-url-context  <- skills/gemini-url-context/mcp-server/server.py
#
# One binary, three subcommands, so the three MCP *server names* already
# registered in skills/mcp.json and mcp/mcp.json survive unchanged. Tool names,
# input schemas, outputs and env-var configuration are a drop-in match for the
# Python — a client cannot tell the difference.
#
# This is what retires imagemagickMcpPythonEnv from flake.nix: that env existed
# solely to give the imagemagick server.py its mcp/httpx/pydantic closure, and
# the supervised [program:imagemagick-mcp] block now runs this binary instead.
#
# Same shape as lib/dream-engine.nix: self-contained [workspace], all deps on
# crates.io, reqwest on rustls-tls with default-features = false, so there is
# NO openssl/pkg-config buildInput. The ImageMagick CLI itself is still
# provided by the mediaPackages gate, not by this derivation.
#
# Licence: MIT OR Apache-2.0.

{ lib, pkgs }:

let
  version = "0.1.0";

  agentboxMcpSrc = lib.cleanSourceWith {
    src    = ../services/agentbox-mcp;
    filter = path: _type: baseNameOf (toString path) != "target";
  };

in
pkgs.rustPlatform.buildRustPackage {
  pname = "agentbox-mcp";
  inherit version;
  src = agentboxMcpSrc;

  cargoLock.lockFile = ../services/agentbox-mcp/Cargo.lock;

  # Tests are hermetic: tool-schema shape, argument construction and env-var
  # defaulting. No network (no Gemini or ZAI call) and no ImageMagick invocation.
  doCheck = true;

  meta = with lib; {
    description = "Multi-tool MCP server for agentbox (rmcp, stdio) — image processing, URL summarisation and Gemini URL-context expansion, replacing three Python FastMCP servers";
    homepage    = "https://github.com/DreamLab-AI/agentbox";
    license     = with licenses; [ mit asl20 ];
    mainProgram = "agentbox-mcp";
    platforms   = platforms.linux;
  };
}
