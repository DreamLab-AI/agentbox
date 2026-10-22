#!/usr/bin/env bash
# Container-level health only: the control endpoint answers. Simulator, physics and render
# health are reported by /v1/capabilities from executed smoke jobs, never inferred from this.
exec /isaac-sim/kit/python/bin/python3 -c \
  'import urllib.request,sys;urllib.request.urlopen("http://127.0.0.1:9890/healthz",timeout=4);sys.exit(0)'
