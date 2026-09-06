# ComfyUI Management API Integration

## Overview

ComfyUI workflow management has been integrated into the Management API on port 9090. This provides REST API endpoints for submitting, monitoring, and managing ComfyUI workflows with real-time WebSocket streaming.

## Architecture

### Components

1. **ComfyUI Routes** (`routes/comfyui.js`)
   - Fastify route handlers for all ComfyUI endpoints
   - JSON schema validation for request/response
   - Authentication via X-API-Key header
   - WebSocket support for real-time updates

2. **ComfyUI Manager** (`utils/comfyui-manager.js`)
   - Workflow queue management
   - Event broadcasting via EventEmitter
   - Model and output file management
   - Priority-based queue processing

3. **Metrics Integration** (`utils/metrics.js`)
   - Prometheus metrics for workflow tracking
   - GPU utilization and VRAM monitoring
   - Queue length tracking
   - Duration histograms

## API Endpoints

### Base URL
```
http://localhost:9090
```

### Authentication
All endpoints require the `X-API-Key` header (except health checks):
```bash
X-API-Key: <MANAGEMENT_API_KEY>
```

### Endpoints

#### 1. Submit Workflow
```http
POST /v1/comfyui/workflow
Content-Type: application/json
X-API-Key: your-api-key

{
  "workflow": {
    // ComfyUI workflow JSON
  },
  "priority": "normal",  // low | normal | high
  "gpu": "local"         // local | salad
}
```

**Response** (202 Accepted):
```json
{
  "workflowId": "uuid",
  "status": "queued",
  "queuePosition": 0
}
```

#### 2. Get Workflow Status
```http
GET /v1/comfyui/workflow/:workflowId
X-API-Key: your-api-key
```

**Response** (200 OK):
```json
{
  "workflowId": "uuid",
  "status": "running",
  "progress": 45,
  "currentNode": "node_4",
  "startTime": 1234567890,
  "completionTime": null,
  "outputs": [],
  "error": null
}
```

**Status Values**:
- `queued` - Workflow is in queue
- `running` - Workflow is executing
- `completed` - Workflow finished successfully
- `cancelled` - Workflow was cancelled
- `failed` - Workflow failed with error

#### 3. Cancel Workflow
```http
DELETE /v1/comfyui/workflow/:workflowId
X-API-Key: your-api-key
```

**Response** (200 OK):
```json
{
  "workflowId": "uuid",
  "status": "cancelled"
}
```

**Error Responses**:
- 404 - Workflow not found
- 409 - Workflow cannot be cancelled (already completed/failed)

#### 4. List Available Models
```http
GET /v1/comfyui/models?type=checkpoints
X-API-Key: your-api-key
```

**Query Parameters**:
- `type` (optional): `checkpoints`, `loras`, `vae`, `controlnet`, `upscale`

**Response** (200 OK):
```json
{
  "models": [
    {
      "name": "model-name.safetensors",
      "type": "checkpoints",
      "size": 4294967296,
      "hash": null
    }
  ]
}
```

#### 5. List Outputs
```http
GET /v1/comfyui/outputs?workflowId=uuid&limit=50
X-API-Key: your-api-key
```

**Query Parameters**:
- `workflowId` (optional): Filter by workflow ID
- `limit` (optional): Number of results (default: 50)

**Response** (200 OK):
```json
{
  "outputs": [
    {
      "filename": "uuid_image.png",
      "workflowId": "uuid",
      "type": "png",
      "size": 1048576,
      "createdAt": 1234567890,
      "url": "/v1/comfyui/output/uuid_image.png"
    }
  ]
}
```

#### 6. WebSocket Stream (Real-time Updates)
```javascript
const ws = new WebSocket('ws://localhost:9090/v1/comfyui/stream');

ws.onopen = () => {
  // Subscribe to specific workflow
  ws.send(JSON.stringify({
    type: 'subscribe',
    workflowId: 'uuid'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Event:', data);
};
```

**Event Types**:
- `workflow:queued` - Workflow added to queue
- `workflow:started` - Workflow execution started
- `workflow:progress` - Progress update
- `workflow:completed` - Workflow completed
- `workflow:cancelled` - Workflow cancelled
- `workflow:error` - Workflow failed

**Event Example**:
```json
{
  "type": "workflow:progress",
  "workflowId": "uuid",
  "progress": 50,
  "currentNode": "node_5",
  "timestamp": 1234567890
}
```

## Prometheus Metrics

The following metrics are available at `/metrics`:

### Workflow Metrics
- `comfyui_workflow_total{status}` - Total workflows by status (counter)
- `comfyui_workflow_duration_seconds{gpu_type}` - Workflow duration (histogram)
- `comfyui_workflow_errors_total{error_type}` - Total errors by type (counter)
- `comfyui_queue_length` - Current queue length (gauge)

### GPU Metrics
- `comfyui_gpu_utilization{gpu_id}` - GPU utilization percentage (gauge)
- `comfyui_vram_usage_bytes{gpu_id}` - VRAM usage in bytes (gauge)

## Configuration

### Environment Variables

```bash
# Management API
MANAGEMENT_API_PORT=9090
MANAGEMENT_API_HOST=0.0.0.0
MANAGEMENT_API_KEY=change-this-secret-key

# ComfyUI Paths
COMFYUI_OUTPUTS=/home/devuser/comfyui/output
COMFYUI_MODELS_CHECKPOINTS=/home/devuser/comfyui/models/checkpoints
COMFYUI_MODELS_LORAS=/home/devuser/comfyui/models/loras
COMFYUI_MODELS_VAE=/home/devuser/comfyui/models/vae
COMFYUI_MODELS_CONTROLNET=/home/devuser/comfyui/models/controlnet
COMFYUI_MODELS_UPSCALE=/home/devuser/comfyui/models/upscale_models
```

## Usage Examples

### Submit a Workflow (cURL)
```bash
curl -X POST http://localhost:9090/v1/comfyui/workflow \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "workflow": {
      "1": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {"ckpt_name": "model.safetensors"}
      }
    },
    "priority": "high",
    "gpu": "local"
  }'
```

### Check Status
```bash
curl http://localhost:9090/v1/comfyui/workflow/your-workflow-id \
  -H "X-API-Key: your-api-key"
```

### List Models
```bash
curl http://localhost:9090/v1/comfyui/models?type=checkpoints \
  -H "X-API-Key: your-api-key"
```

### Cancel Workflow
```bash
curl -X DELETE http://localhost:9090/v1/comfyui/workflow/your-workflow-id \
  -H "X-API-Key: your-api-key"
```

### Monitor with WebSocket (JavaScript)
```javascript
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:9090/v1/comfyui/stream');

ws.on('open', () => {
  console.log('Connected to ComfyUI stream');

  // Subscribe to workflow updates
  ws.send(JSON.stringify({
    type: 'subscribe',
    workflowId: 'your-workflow-id'
  }));
});

ws.on('message', (data) => {
  const event = JSON.parse(data);

  switch(event.type) {
    case 'workflow:progress':
      console.log(`Progress: ${event.progress}%`);
      break;
    case 'workflow:completed':
      console.log('Workflow completed!');
      ws.close();
      break;
    case 'workflow:error':
      console.error('Workflow failed:', event.error);
      ws.close();
      break;
  }
});

ws.on('close', () => {
  console.log('Disconnected from ComfyUI stream');
});
```

### Python Client Example
```python
import requests
import json

API_BASE = "http://localhost:9090"
API_KEY = "your-api-key"
HEADERS = {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY
}

# Submit workflow
workflow = {
    "workflow": {
        # Your ComfyUI workflow JSON
    },
    "priority": "normal",
    "gpu": "local"
}

response = requests.post(
    f"{API_BASE}/v1/comfyui/workflow",
    headers=HEADERS,
    json=workflow
)
result = response.json()
workflow_id = result["workflowId"]

print(f"Workflow submitted: {workflow_id}")

# Poll for status
import time
while True:
    response = requests.get(
        f"{API_BASE}/v1/comfyui/workflow/{workflow_id}",
        headers=HEADERS
    )
    status = response.json()

    print(f"Status: {status['status']} - Progress: {status['progress']}%")

    if status['status'] in ['completed', 'failed', 'cancelled']:
        break

    time.sleep(2)

print("Workflow finished!")
```

## OpenAPI Documentation

Interactive API documentation is available at:
```
http://localhost:9090/docs
```

This provides:
- Full endpoint specifications
- Request/response schemas
- Try-it-out functionality
- Authentication configuration

## Error Handling

All endpoints follow standard HTTP error codes:

- `200 OK` - Success
- `202 Accepted` - Request accepted (async operation)
- `400 Bad Request` - Invalid request data
- `401 Unauthorized` - Missing or invalid API key
- `404 Not Found` - Resource not found
- `409 Conflict` - Operation conflict (e.g., cannot cancel completed workflow)
- `500 Internal Server Error` - Server error

Error responses include:
```json
{
  "error": "ErrorType",
  "message": "Human-readable error message",
  "statusCode": 500
}
```

## Integration with Actual ComfyUI

The current implementation includes:
- ✅ Complete REST API structure
- ✅ Queue management
- ✅ Event broadcasting
- ✅ Prometheus metrics
- ✅ WebSocket streaming
- ⚠️ Simulated workflow execution (needs ComfyUI API integration)

### TODO: Connect to ComfyUI API
To connect to the actual ComfyUI API (typically at http://localhost:8188):

1. Replace `_simulateProgress()` in `comfyui-manager.js` with actual ComfyUI WebSocket client
2. Use ComfyUI's `/prompt` endpoint to submit workflows
3. Listen to ComfyUI's WebSocket for real-time updates
4. Map ComfyUI events to the event system

Example integration snippet:
```javascript
// In comfyui-manager.js
const ComfyUIClient = require('comfyui-client'); // hypothetical

async _processQueue() {
  const workflowId = this.queue.shift();
  const workflowInfo = this.workflows.get(workflowId);

  try {
    // Submit to ComfyUI
    const comfyResult = await fetch('http://localhost:8188/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflowInfo.workflow })
    });

    const { prompt_id } = await comfyResult.json();

    // Listen to ComfyUI WebSocket for updates
    this._listenToComfyUI(workflowId, prompt_id);
  } catch (error) {
    this._handleError(workflowId, error);
  }
}
```

## Security Considerations

1. **Authentication**: All endpoints require API key
2. **Rate Limiting**: 100 requests per minute per IP
3. **File Access**: Output files only accessible via API endpoints
4. **Input Validation**: All requests validated via JSON schema
5. **CORS**: Configured for same-origin by default

## Performance

- Queue processing: Single workflow at a time (configurable)
- WebSocket connections: Unlimited (limited by system resources)
- Metrics overhead: <1ms per request
- File listing: Cached for 60 seconds

## Troubleshooting

### Workflow stuck in queue
Check queue length: `GET /v1/status`

### WebSocket connection fails
Verify:
- `@fastify/websocket` is installed
- No reverse proxy blocking WebSocket upgrade
- Firewall allows port 9090

### Models not listed
Verify:
- Model directories exist and are readable
- Environment variables are set correctly
- User has permissions to read model directories

### Metrics not appearing
Check:
- `/metrics` endpoint is accessible (no auth required)
- Prometheus is scraping the correct port (9090)

## Support

For issues or questions:
- Management API: http://localhost:9090
- API Documentation: http://localhost:9090/docs
- Metrics: http://localhost:9090/metrics
- Health: http://localhost:9090/health
