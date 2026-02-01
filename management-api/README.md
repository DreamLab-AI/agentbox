# Agentic Flow Management API

HTTP Management API for CachyOS Workstation container providing external control, task isolation, and system monitoring.

## Overview

The Management API provides a production-grade HTTP interface for:

- **Task Management**: Create and monitor isolated agentic-flow tasks
- **System Monitoring**: GPU, providers, and system health checks
- **Process Resilience**: Managed by pm2 with auto-restart
- **Security**: Bearer token authentication and rate limiting
- **Structured Logging**: JSON logs for integration with monitoring tools

## Architecture

```
Management API (port 9090)
  ├── Authentication Middleware (Bearer tokens)
  ├── Rate Limiting (100 req/min)
  ├── Task Manager (spawns isolated processes)
  ├── System Monitor (GPU, providers, system health)
  └── Structured Logger (JSON to /home/devuser/logs)
```

### Key Features

1. **Task Isolation**: Each task runs in isolated directory (`/home/devuser/workspace/tasks/{taskId}`)
   - Prevents database locking conflicts
   - Dedicated log files per task
   - Clean task directory structure

2. **Process Management**: pm2 ensures API availability
   - Auto-restart on crash
   - Zero-downtime reloads
   - Process monitoring

3. **Security**:
   - Bearer token authentication
   - Rate limiting (100 req/min per IP)
   - CORS support for web clients

## API Endpoints

### Authentication

All endpoints (except `/health` and `/ready`) require Bearer token authentication:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
     http://localhost:9090/v1/status
```

Set API key via environment variable:
```bash
export MANAGEMENT_API_KEY=your-secure-token
```

### Endpoints

#### `GET /` - API Information
Returns API metadata and endpoint listing.

**Response:**
```json
{
  "name": "Agentic Flow Management API",
  "version": "1.0.0",
  "endpoints": {
    "tasks": {
      "create": "POST /v1/tasks",
      "get": "GET /v1/tasks/:taskId",
      "list": "GET /v1/tasks"
    },
    "monitoring": {
      "status": "GET /v1/status",
      "health": "GET /health",
      "ready": "GET /ready"
    }
  }
}
```

#### `POST /v1/tasks` - Create Task
Spawn a new isolated agentic-flow task.

**Request Body:**
```json
{
  "agent": "coder",
  "task": "Build a REST API with Express",
  "provider": "gemini"
}
```

**Response (202 Accepted):**
```json
{
  "taskId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "accepted",
  "message": "Task started successfully",
  "taskDir": "/home/devuser/workspace/tasks/550e8400-e29b-41d4-a716-446655440000",
  "logFile": "/home/devuser/logs/tasks/550e8400-e29b-41d4-a716-446655440000.log"
}
```

**Example:**
```bash
curl -X POST http://localhost:9090/v1/tasks \
  -H "Authorization: Bearer $MANAGEMENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "coder",
    "task": "Build a REST API",
    "provider": "gemini"
  }'
```

#### `GET /v1/tasks/:taskId` - Get Task Status
Retrieve status and log output for a specific task.

**Response (200 OK):**
```json
{
  "taskId": "550e8400-e29b-41d4-a716-446655440000",
  "agent": "coder",
  "task": "Build a REST API",
  "provider": "gemini",
  "status": "running",
  "startTime": 1704110400000,
  "exitTime": null,
  "exitCode": null,
  "duration": 45000,
  "logTail": "... last 50 lines of log output ..."
}
```

**Status Values:**
- `running`: Task is currently executing
- `completed`: Task finished successfully (exitCode 0)
- `failed`: Task exited with error (exitCode > 0)

**Example:**
```bash
curl -H "Authorization: Bearer $MANAGEMENT_API_KEY" \
     http://localhost:9090/v1/tasks/550e8400-e29b-41d4-a716-446655440000
```

#### `GET /v1/tasks` - List Active Tasks
Get all currently running tasks.

**Response (200 OK):**
```json
{
  "activeTasks": [
    {
      "taskId": "550e8400-e29b-41d4-a716-446655440000",
      "agent": "coder",
      "startTime": 1704110400000,
      "duration": 45000
    }
  ],
  "count": 1
}
```

#### `GET /v1/status` - System Status
Comprehensive system health check including GPU, providers, and system resources.

**Response (200 OK):**
```json
{
  "timestamp": "2025-01-01T12:00:00.000Z",
  "api": {
    "uptime": 3600,
    "version": "1.0.0",
    "pid": 1234
  },
  "tasks": {
    "active": 2
  },
  "gpu": {
    "available": true,
    "gpus": [
      {
        "index": 0,
        "name": "NVIDIA RTX 4090",
        "utilization": 45.5,
        "memory": {
          "used": 8192,
          "total": 24576,
          "percentUsed": "33.33"
        },
        "temperature": 65
      }
    ]
  },
  "providers": {
    "gemini": "configured",
    "openai": "configured",
    "claude": "configured",
    "openrouter": "configured",
    "xinference": "enabled"
  },
  "system": {
    "cpu": {
      "loadAverage": { "load1": 2.5, "load5": 2.2, "load15": 1.8 }
    },
    "memory": {
      "total": 65536,
      "used": 32768,
      "free": 32768,
      "percentUsed": "50.00"
    },
    "disk": {
      "size": "1.0T",
      "used": "500G",
      "available": "500G",
      "percentUsed": "50%"
    }
  }
}
```

#### `GET /health` - Health Check
Simple health check endpoint (no authentication required).

**Response (200 OK):**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-01T12:00:00.000Z"
}
```

#### `GET /ready` - Readiness Probe
Kubernetes-style readiness check (no authentication required).

**Response (200 OK):**
```json
{
  "ready": true,
  "activeTasks": 2,
  "timestamp": "2025-01-01T12:00:00.000Z"
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MANAGEMENT_API_KEY` | `change-this-secret-key` | Bearer token for authentication |
| `MANAGEMENT_API_PORT` | `9090` | API server port |
| `MANAGEMENT_API_HOST` | `0.0.0.0` | API server host |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |
| `NODE_ENV` | `production` | Node environment |

### Security Best Practices

1. **Always change the default API key** in production
2. Set `MANAGEMENT_API_KEY` to a strong random token
3. Use HTTPS in production (configure reverse proxy)
4. Monitor rate limiting logs for abuse
5. Regularly rotate API keys

## Logging

Structured JSON logs are written to:
- **API Logs**: `/home/devuser/logs/management-api.log`
- **Task Logs**: `/home/devuser/logs/tasks/{taskId}.log`

Logs are persisted to Docker volume: `management-logs`

### Log Format

```json
{
  "level": "info",
  "time": "2025-01-01T12:00:00.000Z",
  "reqId": "req-123",
  "msg": "Request completed",
  "responseTime": 45
}
```

## Process Management

The API is managed by pm2:

```bash
# View status
pm2 status

# View logs
pm2 logs management-api

# Restart
pm2 restart management-api

# Stop
pm2 stop management-api
```

## Task Isolation

Each task spawned via `POST /v1/tasks` runs in isolation:

```
/home/devuser/workspace/tasks/{taskId}/
  ├── .db files (SQLite databases)
  ├── generated code
  └── task artifacts

/home/devuser/logs/tasks/{taskId}.log
  └── stdout/stderr output
```

This prevents:
- Database locking conflicts between concurrent tasks
- File system race conditions
- Cross-task interference

## Usage Examples

### Create and Monitor Task

```bash
# Set API key
export API_KEY="your-secure-token"

# Create task
RESPONSE=$(curl -s -X POST http://localhost:9090/v1/tasks \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "coder",
    "task": "Create a simple HTTP server",
    "provider": "gemini"
  }')

TASK_ID=$(echo $RESPONSE | jq -r '.taskId')
echo "Task created: $TASK_ID"

# Poll for status
while true; do
  STATUS=$(curl -s -H "Authorization: Bearer $API_KEY" \
    http://localhost:9090/v1/tasks/$TASK_ID | jq -r '.status')
  echo "Status: $STATUS"
  [[ "$STATUS" != "running" ]] && break
  sleep 5
done

# Get final results
curl -H "Authorization: Bearer $API_KEY" \
  http://localhost:9090/v1/tasks/$TASK_ID | jq
```

### System Monitoring

```bash
# Check system status
curl -H "Authorization: Bearer $API_KEY" \
  http://localhost:9090/v1/status | jq

# Monitor GPU
curl -H "Authorization: Bearer $API_KEY" \
  http://localhost:9090/v1/status | jq '.gpu'

# Check active tasks
curl -H "Authorization: Bearer $API_KEY" \
  http://localhost:9090/v1/tasks | jq '.count'
```

### Integration Example (Python)

```python
import requests
import time
import os

API_URL = "http://localhost:9090"
API_KEY = os.getenv("MANAGEMENT_API_KEY")

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

# Create task
response = requests.post(
    f"{API_URL}/v1/tasks",
    headers=headers,
    json={
        "agent": "coder",
        "task": "Build a TODO API",
        "provider": "gemini"
    }
)
task_id = response.json()["taskId"]
print(f"Task created: {task_id}")

# Poll until complete
while True:
    response = requests.get(
        f"{API_URL}/v1/tasks/{task_id}",
        headers=headers
    )
    status = response.json()

    if status["status"] != "running":
        break

    print(f"Running... ({status['duration']}ms)")
    time.sleep(5)

print(f"Final status: {status['status']}")
print(f"Exit code: {status['exitCode']}")
print(f"Log tail:\n{status['logTail']}")
```

## Troubleshooting

### API Won't Start

Check pm2 logs:
```bash
pm2 logs management-api --lines 50
```

Check port availability:
```bash
netstat -tulpn | grep 9090
```

### Authentication Failures

Verify API key is set:
```bash
echo $MANAGEMENT_API_KEY
```

Test with explicit key:
```bash
curl -H "Authorization: Bearer your-key-here" http://localhost:9090/v1/status
```

### Task Not Starting

Check task log:
```bash
tail -f /home/devuser/logs/tasks/{taskId}.log
```

Verify agentic-flow is in PATH:
```bash
which agentic-flow
```

## Development

### Local Testing

```bash
cd /home/devuser/management-api

# Install dependencies
npm install

# Run in development mode
NODE_ENV=development npm start
```

### Adding New Endpoints

1. Create route file in `routes/`
2. Register in `server.js`
3. Update this README with documentation

## License

MIT
