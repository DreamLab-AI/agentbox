#!/bin/bash
# Legacy user-crontab installer for podcast-knowledge-ingest.
# NOTE: the canonical deployment is supervisord + supercronic (see
# supervisord-podcast-cron.conf / flake.nix [program:podcast-cron]), which
# reads the sibling `crontab` file. Only use this script on a host with a
# classic crond and no supervisord — do NOT run it inside agentbox, or you
# will end up with two schedules.

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${SKILL_DIR}/run-ingest.sh"
CONFIG="${SKILL_DIR}/podcasts.yaml"
# ADR-2028: log beside the transcripts under the vault path authority.
LOG="${VAULT_ROOT:-/home/devuser/workspace/vault}/ai-daily-brief-transcripts/.ingest-log.txt"

# Monday 06:17 UTC, off-minute to avoid thundering herd
CRON_LINE="17 6 * * 1 ${RUNNER} ${CONFIG} >> ${LOG} 2>&1"

if crontab -l 2>/dev/null | grep -q "podcast-knowledge-ingest"; then
    echo "Cron already installed."
else
    (crontab -l 2>/dev/null; echo "# podcast-knowledge-ingest: weekly ontology enrichment from podcasts"; echo "$CRON_LINE") | crontab -
    echo "Cron installed: Monday 06:17 UTC"
fi

echo "Log file: ${LOG}"
echo "Config: ${CONFIG}"
echo "To test: ${RUNNER} ${CONFIG} --dry-run"
