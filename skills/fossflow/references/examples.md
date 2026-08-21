# FossFLOW Worked Examples

Ready-to-adapt examples for both formats. See also `resources/templates/` (`three-tier.json`, `microservices.json`).

## Compact: Network Architecture

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

## Compact: AWS Serverless

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

## Verbose: Full Network with Zones

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
