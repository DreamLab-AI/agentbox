#!/bin/bash
# AISP 5.1 Platinum Initialization Script
# Called during container startup to initialize neuro-symbolic protocol

set -e

AISP_DIR="/opt/aisp"
AISP_LOG="/var/log/aisp-init.log"

echo "[AISP] Initializing AISP 5.1 Platinum neuro-symbolic protocol..."

# Check if AISP module exists
if [ ! -d "$AISP_DIR" ]; then
    echo "[AISP] ERROR: AISP integration module not found at $AISP_DIR"
    exit 1
fi

# Initialize AISP validator
cd "$AISP_DIR"

echo "[AISP] Loading Σ_512 glossary (8 categories × 64 symbols)..."
node -e "
const { AISPValidator } = require('./index.js');
const validator = new AISPValidator();
validator.initialize().then(() => {
    const stats = validator.getStats();
    console.log('[AISP] Glossary loaded:', stats.glossarySize, 'symbols');
    console.log('[AISP] Signal dimensions: V_H=' + stats.config.signalDims.V_H + ', V_L=' + stats.config.signalDims.V_L + ', V_S=' + stats.config.signalDims.V_S);
    console.log('[AISP] Hebbian learning: α=' + stats.config.hebbian.α + ', β=' + stats.config.hebbian.β + ', τ_v=' + stats.config.hebbian.τ_v);
    console.log('[AISP] Quality tiers:', stats.config.qualityTiers.join(', '));
}).catch(err => {
    console.error('[AISP] Initialization failed:', err);
    process.exit(1);
});
" >> "$AISP_LOG" 2>&1

# Store AISP config in AgentDB memory namespace
if command -v claude-flow &> /dev/null; then
    echo "[AISP] Registering with claude-flow memory..."
    claude-flow memory store \
        --key "aisp/config/version" \
        --value "5.1.0" \
        --namespace "aisp" 2>/dev/null || true

    claude-flow memory store \
        --key "aisp/config/glossary" \
        --value '{"categories":8,"symbolsPerCategory":64,"total":512}' \
        --namespace "aisp" 2>/dev/null || true

    claude-flow memory store \
        --key "aisp/config/signalDims" \
        --value '{"V_H":768,"V_L":512,"V_S":256}' \
        --namespace "aisp" 2>/dev/null || true

    claude-flow memory store \
        --key "aisp/config/hebbian" \
        --value '{"alpha":0.1,"beta":0.05,"tau_v":0.7}' \
        --namespace "aisp" 2>/dev/null || true

    echo "[AISP] ✓ Registered with claude-flow memory namespace 'aisp'"
fi

# Validate the AISP specification itself
if [ -f "/home/devuser/workspace/project/multi-agent-docker/aisp.md" ]; then
    echo "[AISP] Validating local aisp.md specification..."
    node "$AISP_DIR/cli.js" validate /home/devuser/workspace/project/multi-agent-docker/aisp.md >> "$AISP_LOG" 2>&1 || true
fi

echo "[AISP] ✓ AISP 5.1 Platinum initialized successfully"
echo "[AISP] Log: $AISP_LOG"
