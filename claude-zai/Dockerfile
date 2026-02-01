FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for Claude Code
RUN useradd -m -s /bin/bash claude && \
    mkdir -p /home/claude/.claude && \
    chown -R claude:claude /home/claude

# Install Claude Code globally
# NOTE: Native installer available via curl -fsSL https://claude.ai/install.sh | bash
# Using npm for Docker system-wide installation (native installer targets ~/.local/bin)
RUN npm install -g @anthropic-ai/claude-code@latest

# Create app directory
WORKDIR /app

# Create wrapper service directory
RUN mkdir -p /app/wrapper

# Copy wrapper files
COPY claude-zai/wrapper/ /app/wrapper/

# Install wrapper dependencies
WORKDIR /app/wrapper
RUN npm install

# Copy config template (will be populated at runtime)
COPY claude-zai/claude-config.json /app/claude-config.template.json

# Change ownership of app directory
RUN chown -R claude:claude /app

# Set Claude config directory before switching user
ENV CLAUDE_CONFIG_DIR=/home/claude/.claude
ENV HOME=/home/claude

# Switch to non-root user
USER claude

# Expose HTTP API port
EXPOSE 9600

# Create entrypoint script to substitute env vars
RUN echo '#!/bin/bash\n\
set -e\n\
# Substitute environment variables in config\n\
mkdir -p /home/claude/.claude\n\
envsubst < /app/claude-config.template.json > /home/claude/.claude/.claude.json\n\
chown -R claude:claude /home/claude/.claude\n\
# Start the service\n\
exec node server.js\n\
' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Install envsubst (from gettext package)
USER root
RUN apt-get update && apt-get install -y gettext-base && rm -rf /var/lib/apt/lists/*
USER claude

# Start via entrypoint
CMD ["/app/entrypoint.sh"]
