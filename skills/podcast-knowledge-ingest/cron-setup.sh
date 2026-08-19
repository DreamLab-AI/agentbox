#!/bin/bash
# Persistent cron setup for podcast-knowledge-ingest.
# The CronCreate MCP tool only lives for the Claude session.
# For a durable cron, add this to the container's crontab:

SCRIPT="/home/devuser/workspace/project/agentbox/skills/podcast-knowledge-ingest/ingest.py"
CONFIG="/home/devuser/workspace/logseq/ai-daily-brief-transcripts/podcasts.yaml"
LOG="/home/devuser/workspace/logseq/ai-daily-brief-transcripts/.ingest-log.txt"

# Add to crontab (Monday 06:17 UTC, off-minute to avoid thundering herd)
CRON_LINE="17 6 * * 1 PYTHONPATH=/home/devuser/.local/lib/python3.12/site-packages /usr/bin/python3 ${SCRIPT} --config ${CONFIG} >> ${LOG} 2>&1"

# Check if already installed
if crontab -l 2>/dev/null | grep -q "podcast-knowledge-ingest"; then
    echo "Cron already installed."
else
    (crontab -l 2>/dev/null; echo "# podcast-knowledge-ingest: weekly ontology enrichment from podcasts"; echo "$CRON_LINE") | crontab -
    echo "Cron installed: Monday 06:17 UTC"
fi

echo "Log file: ${LOG}"
echo "Config: ${CONFIG}"
echo "To test: python3 ${SCRIPT} --config ${CONFIG} --dry-run"
