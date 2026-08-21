# Host Webserver Debug — Troubleshooting

## Bridge won't start

```bash
# Check if port is in use
ss -tlnp | grep 3001

# Kill existing process
pkill -f https-proxy

# Regenerate certificates
cd /opt/https-bridge
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout server.key -out server.crt -subj "/CN=localhost"
```

## Host unreachable

```bash
# Detect host gateway
ip route | grep default | awk '{print $3}'

# Test connectivity
ping -c 1 192.168.0.51
curl -s http://192.168.0.51:3001
```

## Browser certificate errors

The browsercontainer sidecar Chrome already launches with certificate errors ignored, so
self-signed bridge certificates are accepted without extra flags. If you see cert errors,
you are almost certainly running a local browser instead of the sidecar — switch to the
`browser-gpu` MCP tools (see the `browser` skill). Do not stand up a local Playwright or
Chromium on `DISPLAY :1`; that path is deprecated.

## Check bridge logs

```bash
# Supervisord logs
supervisorctl tail -f https-bridge

# Or direct log file
tail -f /var/log/https-bridge.log
```

## Sidecar can't reach the bridge

`localhost` inside the bridge container is not `localhost` in the sidecar. Publish the
bridge on the container hostname or a shared Docker network and point the sidecar at that
address. Verify with:

```bash
curl -sk https://<bridge-host>:3001
```
