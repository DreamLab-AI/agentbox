# QUIC Synchronization

## What is QUIC Sync?

QUIC (Quick UDP Internet Connections) enables sub-millisecond latency synchronization between AgentDB instances across network boundaries with automatic retry, multiplexing, and encryption.

**Benefits**:
- <1ms latency between nodes
- Multiplexed streams (multiple operations simultaneously)
- Built-in encryption (TLS 1.3)
- Automatic retry and recovery
- Event-based broadcasting

## Enable QUIC Sync

```typescript
import { createAgentDBAdapter } from 'agentic-flow/reasoningbank';

// Initialize with QUIC synchronization
const adapter = await createAgentDBAdapter({
  dbPath: '.agentdb/distributed.db',
  enableQUICSync: true,
  syncPort: 4433,
  syncPeers: [
    '192.168.1.10:4433',
    '192.168.1.11:4433',
    '192.168.1.12:4433',
  ],
});

// Patterns automatically sync across all peers
await adapter.insertPattern({
  // ... pattern data
});

// Available on all peers within ~1ms
```

## QUIC Configuration

```typescript
const adapter = await createAgentDBAdapter({
  enableQUICSync: true,
  syncPort: 4433,              // QUIC server port
  syncPeers: ['host1:4433'],   // Peer addresses
  syncInterval: 1000,          // Sync interval (ms)
  syncBatchSize: 100,          // Patterns per batch
  maxRetries: 3,               // Retry failed syncs
  compression: true,           // Enable compression
});
```

## Multi-Node Deployment

```bash
# Node 1 (192.168.1.10)
AGENTDB_QUIC_SYNC=true \
AGENTDB_QUIC_PORT=4433 \
AGENTDB_QUIC_PEERS=192.168.1.11:4433,192.168.1.12:4433 \
node server.js

# Node 2 (192.168.1.11)
AGENTDB_QUIC_SYNC=true \
AGENTDB_QUIC_PORT=4433 \
AGENTDB_QUIC_PEERS=192.168.1.10:4433,192.168.1.12:4433 \
node server.js

# Node 3 (192.168.1.12)
AGENTDB_QUIC_SYNC=true \
AGENTDB_QUIC_PORT=4433 \
AGENTDB_QUIC_PEERS=192.168.1.10:4433,192.168.1.11:4433 \
node server.js
```

## QUIC Environment Variables

```bash
AGENTDB_QUIC_SYNC=true
AGENTDB_QUIC_PORT=4433
AGENTDB_QUIC_PEERS=host1:4433,host2:4433
```

For common AgentDB environment variables, see [AgentDB Overview](../docs/agentdb-overview.md#environment-variables).

## Troubleshooting: QUIC sync not working

```bash
# Check firewall allows UDP port 4433
sudo ufw allow 4433/udp

# Verify peers are reachable
ping host1

# Check QUIC logs
DEBUG=agentdb:quic node server.js
```
