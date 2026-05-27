# Tailscale

Tailscale provides a WireGuard-based mesh network that lets agentbox instances
federate with your tailnet without punching holes in firewalls or managing
static IPs.

## Enable

In `agentbox.toml`:

```toml
[networking]
tailscale = true
```

The build gates both the Tailscale binary and the associated supervisor block
on this flag. When disabled, the binary is not present in the image.

## Capabilities

Tailscale requires `NET_ADMIN` to configure the virtual network interface.
The manifest grants this via the security exceptions block:

```toml
[security.exceptions.tailscale]
cap_add = ["NET_ADMIN"]
devices = ["/dev/net/tun"]
```

These are included automatically when `networking.tailscale = true`; you do
not need to add them manually.

## State persistence

Tailscale stores its node identity (keys, coordination state) under
`/var/lib/tailscale`. The compose stack mounts a named volume there:

```
tailscale-state:/var/lib/tailscale
```

This means the node keeps its stable Tailscale IP and does not re-authenticate
on image rebuilds.

## Joining your tailnet

Once the container is running:

```bash
docker exec -it <container> tailscale up
```

Follow the URL printed to authenticate. For headless / CI environments use an
[auth key](https://tailscale.com/kb/1085/auth-keys):

```bash
docker exec -it <container> tailscale up --authkey=tskey-auth-...
```

## Using with mesh federation

With Tailscale active, peer relay addresses can use stable Tailscale hostnames:

```toml
[mesh]
mode = "client"
peer_relays = ["wss://my-other-agentbox:7777"]
```

Replace `my-other-agentbox` with the MagicDNS name visible in your tailnet
admin console.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `tailscale up` hangs | Verify `NET_ADMIN` cap and `/dev/net/tun` device in compose |
| Node re-auths on rebuild | Confirm `tailscale-state` volume is mounted and not pruned |
| Peers unreachable | Check tailnet ACLs; agentbox relay port is `7777` by default |
