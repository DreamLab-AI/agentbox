---
name: defense-security
description: >
  Linux defensive security with 31 modules and 250+ actions. Firewall management,
  system hardening, compliance auditing (CIS/HIPAA/SOC2), malware scanning,
  incident response, container security, network defense, zero trust architecture,
  and forensics. Dry-run by default with confirmation gates.
  Use when hardening Linux systems, auditing compliance (CIS/HIPAA/SOC2), scanning for malware, or doing incident response.
version: 1.0.0
author: agentbox-claude
mcp_server: true
protocol: stdio
entry_point: npx defense-mcp-server
dependencies:
  - node >= 22
env_vars:
  - DEFENSE_MCP_DRY_RUN
  - DEFENSE_MCP_REQUIRE_CONFIRMATION
  - DEFENSE_MCP_ALLOWED_DIRS
  - DEFENSE_MCP_AUTO_INSTALL
  - DEFENSE_MCP_LOG_LEVEL
  - DEFENSE_MCP_SESSION_TIMEOUT
---

# Defense Security MCP Skill

Comprehensive Linux defensive security toolkit exposing 31 modules and 250+ actions through MCP. All destructive operations default to dry-run mode with mandatory confirmation gates. Sudo authentication uses GUI dialog (zenity/kdialog), never passing credentials through AI context.

## When to Use This Skill

- **Firewall Management**: Configure iptables/nftables rules, port management, traffic filtering
- **System Hardening**: Apply CIS benchmarks, disable unnecessary services, configure secure defaults
- **Compliance Auditing**: Run CIS, HIPAA, SOC2, PCI-DSS compliance checks with remediation guidance
- **Malware Scanning**: Scan filesystems with ClamAV, YARA rules, rootkit detection
- **Incident Response**: Collect forensic artifacts, analyze logs, quarantine threats, generate timelines
- **Container Security**: Audit Docker/Podman configs, scan images, check runtime isolation
- **Network Defense**: Monitor connections, detect anomalies, configure IDS/IPS rules
- **Zero Trust**: Implement least-privilege policies, verify network segmentation, audit access controls
- **Forensics**: Disk imaging, memory analysis, file integrity verification, chain of custody

## When Not To Use

- For Windows or macOS systems -- this skill is Linux only
- For offensive security, penetration testing, or exploit development -- defensive only
- For cloud-native security without a local Linux host -- use cloud provider security tools (AWS GuardDuty, GCP SCC)
- For application-layer security scanning (SAST/DAST) -- use dedicated tools like Semgrep or OWASP ZAP
- For network packet capture analysis -- use Wireshark or tcpdump directly

## Architecture

```
┌─────────────────────────────────┐
│  Claude Code / Skill Invocation │
└──────────────┬──────────────────┘
               │ MCP Protocol (stdio)
               ▼
┌─────────────────────────────────┐
│  Defense MCP Server (Node.js)   │
│  31 modules, 250+ actions       │
│  Dry-run + confirmation gates   │
└──────────────┬──────────────────┘
               │ Subprocess / API
               ▼
┌─────────────────────────────────┐
│  Linux Security Subsystems      │
│  iptables, auditd, ClamAV,     │
│  systemd, AppArmor/SELinux,     │
│  Docker, journalctl, etc.       │
└─────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  Sudo Authentication            │
│  (zenity/kdialog GUI dialog)    │
│  Never through AI context       │
└─────────────────────────────────┘
```

## Modules Overview

| Category | Modules | Actions |
|----------|---------|---------|
| **Firewall** | iptables, nftables, ufw | Rule management, port control, traffic shaping |
| **Hardening** | CIS benchmarks, sysctl, PAM | Service hardening, kernel params, auth config |
| **Compliance** | CIS, HIPAA, SOC2, PCI-DSS | Audit checks, gap analysis, remediation plans |
| **Malware** | ClamAV, YARA, rkhunter | File scanning, rootkit detection, quarantine |
| **Incident Response** | Log analysis, artifact collection | Timeline generation, IOC extraction, containment |
| **Container** | Docker, Podman, OCI | Image scanning, runtime audit, config review |
| **Network** | Connections, IDS, DNS | Anomaly detection, traffic analysis, DNS filtering |
| **Zero Trust** | Access control, segmentation | Policy enforcement, privilege auditing |
| **Forensics** | Disk, memory, files | Imaging, integrity checks, evidence preservation |

## Safety Model

All operations follow a three-tier safety model:

1. **Dry-run by default**: `DEFENSE_MCP_DRY_RUN=true` -- commands are logged but not executed
2. **Confirmation gates**: `DEFENSE_MCP_REQUIRE_CONFIRMATION=true` -- destructive actions require explicit approval
3. **GUI sudo**: Privilege escalation uses zenity/kdialog dialogs, never exposing credentials to the AI

## Examples

```python
# Run a CIS compliance audit (dry-run)
defense_compliance_audit({
    "framework": "cis",
    "level": 1,
    "output_format": "json"
})

# Check firewall status
defense_firewall_status({
    "backend": "iptables"
})

# Scan directory for malware
defense_malware_scan({
    "path": "/var/www/html",
    "engine": "clamav",
    "recursive": true
})

# Harden SSH configuration
defense_harden_service({
    "service": "sshd",
    "benchmark": "cis",
    "dry_run": true
})

# Collect incident response artifacts
defense_ir_collect({
    "artifact_types": ["logs", "connections", "processes", "users"],
    "timeframe": "24h",
    "output_dir": "/tmp/ir-artifacts"
})

# Audit Docker containers
defense_container_audit({
    "runtime": "docker",
    "checks": ["privileges", "network", "volumes", "image_age"]
})
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEFENSE_MCP_DRY_RUN` | No | `true` | When true, commands are logged but not executed |
| `DEFENSE_MCP_REQUIRE_CONFIRMATION` | No | `true` | Require explicit confirmation for destructive actions |
| `DEFENSE_MCP_ALLOWED_DIRS` | No | `/` | Comma-separated list of directories the tool may scan |
| `DEFENSE_MCP_AUTO_INSTALL` | No | `false` | Auto-install missing security tools (ClamAV, rkhunter, etc.) |
| `DEFENSE_MCP_LOG_LEVEL` | No | `info` | Logging verbosity: debug, info, warn, error |
| `DEFENSE_MCP_SESSION_TIMEOUT` | No | `3600` | Session timeout in seconds |

## Setup

```bash
# Install globally
npm install -g defense-mcp-server

# Or run via npx
npx defense-mcp-server

# Prerequisites (install security tools as needed)
sudo apt install clamav clamav-daemon auditd rkhunter lynis
```

## Requirements

- **OS**: Linux only (Debian/Ubuntu, RHEL/CentOS, Arch)
- **Runtime**: Node.js 22+
- **Privileges**: sudo access via GUI dialog for privileged operations
- **Optional tools**: ClamAV, auditd, rkhunter, lynis, AppArmor/SELinux utilities

## Troubleshooting

**Sudo Dialog Not Appearing:**
```bash
# Ensure zenity or kdialog is installed
sudo apt install zenity
# Or for KDE
sudo apt install kdialog
```

**ClamAV Database Outdated:**
```bash
# Update ClamAV signatures
sudo freshclam
```

**Permission Denied on Scan:**
```bash
# Expand allowed directories
export DEFENSE_MCP_ALLOWED_DIRS="/home,/var,/etc,/tmp"
```

**Dry-Run Mode Confusion:**
```bash
# To execute real changes (use with caution)
export DEFENSE_MCP_DRY_RUN=false
export DEFENSE_MCP_REQUIRE_CONFIRMATION=true  # Keep confirmation on
```

**Missing Security Tools:**
```bash
# Enable auto-install (will prompt for sudo)
export DEFENSE_MCP_AUTO_INSTALL=true
```

## Integration with Other Skills

Combine with:
- `build-with-quality`: Run security scans as part of CI/CD quality gates
- `report-builder`: Generate compliance audit reports in PDF/HTML
- `sparc-methodology`: Include security hardening in architecture specifications
- `github-workflow-automation`: Trigger security scans on PR merge
