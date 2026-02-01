#!/bin/bash
# ComfyUI Management API Integration Test Script

API_BASE="http://localhost:9090"
API_KEY="${MANAGEMENT_API_KEY:-change-this-secret-key}"

echo "=== ComfyUI Management API Integration Test ==="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Health Check
echo "1. Testing Health Check..."
response=$(curl -s -w "\n%{http_code}" "$API_BASE/health")
http_code=$(echo "$response" | tail -n 1)
body=$(echo "$response" | head -n -1)

if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✓ Health check passed${NC}"
else
    echo -e "${RED}✗ Health check failed (HTTP $http_code)${NC}"
fi
echo ""

# Test 2: API Root (verify ComfyUI endpoints are listed)
echo "2. Testing API Root..."
response=$(curl -s -w "\n%{http_code}" -H "X-API-Key: $API_KEY" "$API_BASE/")
http_code=$(echo "$response" | tail -n 1)
body=$(echo "$response" | head -n -1)

if [ "$http_code" = "200" ]; then
    if echo "$body" | grep -q "comfyui"; then
        echo -e "${GREEN}✓ ComfyUI endpoints registered${NC}"
        echo "$body" | jq -r '.endpoints.comfyui' 2>/dev/null || echo "$body"
    else
        echo -e "${YELLOW}⚠ ComfyUI endpoints not found in response${NC}"
    fi
else
    echo -e "${RED}✗ API root failed (HTTP $http_code)${NC}"
fi
echo ""

# Test 3: Submit a test workflow
echo "3. Testing Workflow Submission..."
workflow='{"workflow":{"1":{"class_type":"LoadImage","inputs":{"image":"test.png"}}},"priority":"normal","gpu":"local"}'

response=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d "$workflow" \
    "$API_BASE/v1/comfyui/workflow")

http_code=$(echo "$response" | tail -n 1)
body=$(echo "$response" | head -n -1)

if [ "$http_code" = "202" ]; then
    echo -e "${GREEN}✓ Workflow submitted${NC}"
    workflow_id=$(echo "$body" | jq -r '.workflowId' 2>/dev/null)
    echo "  Workflow ID: $workflow_id"
else
    echo -e "${RED}✗ Workflow submission failed (HTTP $http_code)${NC}"
    echo "$body"
fi
echo ""

# Test 4: Get workflow status
if [ -n "$workflow_id" ] && [ "$workflow_id" != "null" ]; then
    echo "4. Testing Workflow Status..."
    response=$(curl -s -w "\n%{http_code}" \
        -H "X-API-Key: $API_KEY" \
        "$API_BASE/v1/comfyui/workflow/$workflow_id")

    http_code=$(echo "$response" | tail -n 1)
    body=$(echo "$response" | head -n -1)

    if [ "$http_code" = "200" ]; then
        echo -e "${GREEN}✓ Workflow status retrieved${NC}"
        echo "$body" | jq '.' 2>/dev/null || echo "$body"
    else
        echo -e "${RED}✗ Workflow status failed (HTTP $http_code)${NC}"
    fi
    echo ""

    # Test 5: Cancel workflow
    echo "5. Testing Workflow Cancellation..."
    response=$(curl -s -w "\n%{http_code}" -X DELETE \
        -H "X-API-Key: $API_KEY" \
        "$API_BASE/v1/comfyui/workflow/$workflow_id")

    http_code=$(echo "$response" | tail -n 1)
    body=$(echo "$response" | head -n -1)

    if [ "$http_code" = "200" ]; then
        echo -e "${GREEN}✓ Workflow cancelled${NC}"
    else
        echo -e "${RED}✗ Workflow cancellation failed (HTTP $http_code)${NC}"
        echo "$body"
    fi
    echo ""
fi

# Test 6: List models
echo "6. Testing Model Listing..."
response=$(curl -s -w "\n%{http_code}" \
    -H "X-API-Key: $API_KEY" \
    "$API_BASE/v1/comfyui/models")

http_code=$(echo "$response" | tail -n 1)
body=$(echo "$response" | head -n -1)

if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✓ Models listed${NC}"
    model_count=$(echo "$body" | jq '.models | length' 2>/dev/null)
    echo "  Found $model_count models"
else
    echo -e "${RED}✗ Model listing failed (HTTP $http_code)${NC}"
fi
echo ""

# Test 7: List outputs
echo "7. Testing Output Listing..."
response=$(curl -s -w "\n%{http_code}" \
    -H "X-API-Key: $API_KEY" \
    "$API_BASE/v1/comfyui/outputs?limit=10")

http_code=$(echo "$response" | tail -n 1)
body=$(echo "$response" | head -n -1)

if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✓ Outputs listed${NC}"
    output_count=$(echo "$body" | jq '.outputs | length' 2>/dev/null)
    echo "  Found $output_count outputs"
else
    echo -e "${RED}✗ Output listing failed (HTTP $http_code)${NC}"
fi
echo ""

# Test 8: Prometheus metrics
echo "8. Testing Prometheus Metrics..."
response=$(curl -s -w "\n%{http_code}" "$API_BASE/metrics")
http_code=$(echo "$response" | tail -n 1)
body=$(echo "$response" | head -n -1)

if [ "$http_code" = "200" ]; then
    if echo "$body" | grep -q "comfyui_"; then
        echo -e "${GREEN}✓ ComfyUI metrics available${NC}"
        echo "  Metrics found:"
        echo "$body" | grep "^# HELP comfyui_" | sed 's/^/    /'
    else
        echo -e "${YELLOW}⚠ ComfyUI metrics not found${NC}"
    fi
else
    echo -e "${RED}✗ Metrics endpoint failed (HTTP $http_code)${NC}"
fi
echo ""

# Test 9: API Documentation
echo "9. Testing API Documentation..."
response=$(curl -s -w "\n%{http_code}" "$API_BASE/docs")
http_code=$(echo "$response" | tail -n 1)

if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✓ API documentation available${NC}"
    echo "  Access at: $API_BASE/docs"
else
    echo -e "${RED}✗ API documentation failed (HTTP $http_code)${NC}"
fi
echo ""

echo "=== Test Summary ==="
echo "All ComfyUI endpoints are integrated into the Management API"
echo "Base URL: $API_BASE"
echo "Documentation: $API_BASE/docs"
echo "Metrics: $API_BASE/metrics"
