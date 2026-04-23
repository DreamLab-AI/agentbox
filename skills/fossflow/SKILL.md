---
name: fossflow
description: >
  Generate isometric network and architecture diagrams for FossFLOW visualisation.
  Supports compact LLM-optimised format and full SVG/JSON. Use when creating network
  topology diagrams, infrastructure maps, or architecture visualisations.
---

# FossFLOW Diagram Generator

Generate isometric network and architecture diagrams for FossFLOW visualization.

## When Not To Use

- For standard flowcharts, sequence diagrams, or Mermaid-supported types -- use the mermaid-diagrams skill
- For academic publication figures -- use the paperbanana skill
- For general architecture documentation -- use the report-builder skill

## Two Supported Formats

### 1. Compact Format (LLM-Optimized)

Token-efficient format (70-90% reduction) designed for LLM generation:

```json
{
  "t": "Diagram Title",
  "i": [
    ["Item Name", "icon_name", "Description (max 100 chars)"],
    ["Database", "storage", "PostgreSQL primary server"]
  ],
  "v": [
    [
      [[0, 0, 0], [1, 4, 2]],
      [[0, 1]]
    ]
  ],
  "_": { "f": "compact", "v": "1.0" }
}
```

**Keys:**
- `t`: Title (max 40 chars)
- `i`: Items array - each is `["Name (max 30)", "icon", "Description (max 100)"]`
- `v`: Views - contains `[[positions], [connections]]`
  - Positions: `[itemIndex, x, y]` (indices 0 to n-1)
  - Connections: `[fromIndex, toIndex]`
- `_`: Metadata - **MUST be exactly** `{"f": "compact", "v": "1.0"}`

### 2. Verbose Format (Full Features)

Full-featured format with zones, labels, and styling:

```json
{
  "title": "Diagram Title",
  "description": "Optional description",
  "fitToScreen": true,
  "items": [
    {
      "id": "server1",
      "name": "Web Server",
      "description": "Nginx proxy",
      "icon": "server",
      "position": { "x": 0, "y": 0 }
    }
  ],
  "connectors": [
    {
      "id": "c1",
      "from": "server1",
      "to": "database",
      "color": "blue",
      "showArrow": true,
      "style": "SOLID",
      "width": 1,
      "labels": [
        { "id": "l1", "text": "TCP/5432", "position": 50 }
      ]
    }
  ],
  "colors": [
    { "id": "blue", "value": "#4A90D9" }
  ],
  "rectangles": [
    { "id": "zone1", "from": { "x": -1, "y": -1 }, "to": { "x": 5, "y": 3 }, "color": "blue" }
  ],
  "textBoxes": [
    { "id": "t1", "text": "Zone Label", "position": { "x": 2, "y": -2 } }
  ],
  "icons": []
}
```

## Available Icons (1,062 Total)

### ISOFLOW Basic Icons (37)
```
block         cache         cardterminal  cloud         cronjob
cube          desktop       diamond       dns           document
firewall      function-module              image         laptop
loadbalancer  lock          mail          mailmultiple  mobiledevice
office        package-module               paymentcard   plane
printer       pyramid       queue         router        server
speech        sphere        storage       switch-module tower
truck         truck-2       user          vm
```

### AWS Icons (320) - Use `aws-` prefix
```
aws-ec2, aws-s3, aws-rds, aws-lambda, aws-api-gateway, aws-cloudfront,
aws-vpc, aws-dynamodb, aws-elasticache, aws-elastic-load-balancing,
aws-elastic-kubernetes-service, aws-fargate, aws-cloudwatch, aws-cognito,
aws-simple-queue-service, aws-simple-notification-service, aws-route-53,
aws-certificate-manager, aws-waf, aws-secrets-manager, aws-kinesis, ...
```

### Azure Icons (369) - Use `azure-` prefix
```
azure-virtual-machine, azure-storage-account, azure-sql-database,
azure-function-apps, azure-kubernetes-services, azure-app-services,
azure-load-balancers, azure-active-directory, azure-cosmos-db,
azure-service-bus, azure-event-hubs, azure-monitor, azure-key-vaults, ...
```

### GCP Icons (280) - Use `gcp-` prefix
```
gcp-compute-engine, gcp-cloud-storage, gcp-cloud-sql, gcp-cloud-functions,
gcp-kubernetes-engine, gcp-cloud-run, gcp-pubsub, gcp-bigquery,
gcp-cloud-cdn, gcp-cloud-load-balancing, gcp-cloud-armor, gcp-firestore, ...
```

### Kubernetes Icons (56) - Use `k8s-` prefix
```
k8s-pod, k8s-service, k8s-deployment, k8s-ingress, k8s-node,
k8s-secret, k8s-configmap, k8s-namespace, k8s-pv, k8s-pvc,
k8s-hpa, k8s-statefulset, k8s-daemonset, k8s-job, k8s-cronjob, ...
```

## Icon Mapping Quick Reference

| Purpose | Icon |
|---------|------|
| Server/Host | `server`, `vm` |
| Database | `storage` |
| Network Switch | `switch-module` |
| Router/Gateway | `router`, `loadbalancer` |
| Firewall | `firewall` |
| Cloud Service | `cloud` |
| User/Person | `user` |
| Mobile Device | `mobiledevice` |
| Desktop/Laptop | `desktop`, `laptop` |
| Function/Lambda | `function-module` |
| Message Queue | `queue` |
| Cache | `cache` |
| Lock/Auth | `lock` |

## Positioning System

- Grid-based coordinates (x, y)
- Range: typically -20 to +20
- Spacing: 3-5 units between items
- X: horizontal (negative=left, positive=right)
- Y: vertical (negative=up, positive=down)

## Examples

### Compact: Network Architecture

```json
{
  "t": "Fairfield House Network",
  "i": [
    ["Internet", "cloud", "Public internet"],
    ["VPS Aggregator", "server", "WireGuard load balancing"],
    ["Primary WAN", "router", "EE Fibre 67Mbps"],
    ["5G WAN", "mobiledevice", "EE 5G outdoor modem"],
    ["Gateway", "firewall", "UDM-Pro policy routing"],
    ["Core Switch", "switch-module", "USW-Pro-Max-24 PoE"],
    ["WiFi AP", "desktop", "U7-Pro WiFi 7"],
    ["Devices", "user", "House devices"]
  ],
  "v": [
    [
      [[0, 0, -8], [1, 0, -4], [2, -4, 0], [3, 4, 0], [4, 0, 4], [5, 0, 8], [6, 0, 12], [7, 0, 16]],
      [[0, 1], [1, 2], [1, 3], [2, 4], [3, 4], [4, 5], [5, 6], [6, 7]]
    ]
  ],
  "_": { "f": "compact", "v": "1.0" }
}
```

### Compact: AWS Serverless

```json
{
  "t": "AWS Serverless Architecture",
  "i": [
    ["CloudFront", "aws-cloudfront", "CDN edge locations"],
    ["API Gateway", "aws-api-gateway", "REST API management"],
    ["Lambda", "aws-lambda", "Serverless functions"],
    ["DynamoDB", "aws-dynamodb", "NoSQL database"],
    ["S3", "aws-s3", "Static file storage"],
    ["Cognito", "aws-cognito", "User authentication"]
  ],
  "v": [
    [
      [[0, -8, -4], [1, 0, 0], [2, 0, 4], [3, 8, 4], [4, 8, -4], [5, -8, 4]],
      [[0, 1], [1, 2], [2, 3], [0, 4], [1, 5]]
    ]
  ],
  "_": { "f": "compact", "v": "1.0" }
}
```

### Verbose: Full Network with Zones

```json
{
  "title": "Data Center Network",
  "description": "Three-tier architecture with DMZ",
  "fitToScreen": true,
  "items": [
    { "id": "inet", "name": "Internet", "icon": "cloud", "position": { "x": 0, "y": 0 } },
    { "id": "fw", "name": "Firewall", "icon": "firewall", "position": { "x": 4, "y": 0 } },
    { "id": "lb", "name": "Load Balancer", "icon": "loadbalancer", "position": { "x": 8, "y": 0 } },
    { "id": "web1", "name": "Web Server 1", "icon": "server", "position": { "x": 10, "y": -2 } },
    { "id": "web2", "name": "Web Server 2", "icon": "server", "position": { "x": 10, "y": 2 } },
    { "id": "db", "name": "Database", "icon": "storage", "position": { "x": 14, "y": 0 } }
  ],
  "connectors": [
    { "id": "c1", "from": "inet", "to": "fw", "color": "orange", "showArrow": true },
    { "id": "c2", "from": "fw", "to": "lb", "color": "blue", "showArrow": true, "labels": [{ "id": "l1", "text": "HTTPS", "position": 50 }] },
    { "id": "c3", "from": "lb", "to": "web1", "color": "green", "showArrow": true },
    { "id": "c4", "from": "lb", "to": "web2", "color": "green", "showArrow": true },
    { "id": "c5", "from": "web1", "to": "db", "color": "purple", "style": "DASHED" },
    { "id": "c6", "from": "web2", "to": "db", "color": "purple", "style": "DASHED" }
  ],
  "colors": [
    { "id": "orange", "value": "#FF9800" },
    { "id": "blue", "value": "#4A90D9" },
    { "id": "green", "value": "#7CB342" },
    { "id": "purple", "value": "#9C27B0" }
  ],
  "rectangles": [
    { "id": "dmz", "from": { "x": 3, "y": -3 }, "to": { "x": 9, "y": 3 }, "color": "orange" },
    { "id": "app", "from": { "x": 9, "y": -4 }, "to": { "x": 15, "y": 4 }, "color": "green" }
  ],
  "textBoxes": [
    { "id": "t1", "text": "DMZ", "position": { "x": 6, "y": -4 } },
    { "id": "t2", "text": "Application Tier", "position": { "x": 12, "y": -5 } }
  ],
  "icons": []
}
```

## Connector Properties (Verbose)

| Property | Values |
|----------|--------|
| `style` | `SOLID` (default), `DASHED`, `DOTTED` |
| `showArrow` | `true`, `false` |
| `width` | 1-5 |
| `color` | Reference to color ID |
| `labels` | Array: `[{ id, text, position: 0-100 }]` |

## Standard Color Palette

```json
"colors": [
  { "id": "blue", "value": "#4A90D9" },
  { "id": "green", "value": "#7CB342" },
  { "id": "orange", "value": "#FF9800" },
  { "id": "red", "value": "#E53935" },
  { "id": "purple", "value": "#9C27B0" },
  { "id": "teal", "value": "#00ACC1" },
  { "id": "gray", "value": "#78909C" },
  { "id": "cyan", "value": "#26C6DA" }
]
```

## Validation Checklist

**Compact Format:**
- [ ] Metadata exactly `{"f": "compact", "v": "1.0"}`
- [ ] Item names max 30 chars, descriptions max 100 chars
- [ ] Title max 40 chars
- [ ] Connection indices valid (0 to n-1)
- [ ] Icon names from available list

**Verbose Format:**
- [ ] All items have unique `id`
- [ ] Connector `from`/`to` match item IDs
- [ ] Colors referenced in connectors exist in `colors` array
- [ ] Icon names from available list

**Both Formats:**
- [ ] Positions within -20 to +20 range
- [ ] 3-5 unit spacing between connected items
- [ ] Valid JSON structure

## Running FossFLOW

```bash
# Local development
cd /home/devuser/workspace/dreamlab-cumbria/FossFLOW
npm install && npm run dev
# Access at http://localhost:3001

# Import diagram: Hamburger menu → Open → Select JSON
# Fit to screen: Press '0' key
# Export: File menu → Export
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Error in your model" | Check metadata format, icon names, and JSON structure |
| Connectors invisible | Verify from/to IDs match item IDs exactly |
| Icons missing | Use exact icon names (case-sensitive) |
| Layout cramped | Increase coordinate spacing to 4-6 units |
| Import fails | Validate JSON; check required fields |
