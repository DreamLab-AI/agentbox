#!/usr/bin/env bash
# start-agentbox.sh — interactive wizard to configure agentbox.toml and optionally build/start
# Whiptail-only TUI; falls back to plain-text prompts when whiptail/dialog is absent.
# Pass --validate-only to run the validator against the existing manifest and exit.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${ROOT_DIR}/agentbox.toml"
ENV_EXAMPLE="${ROOT_DIR}/.env.example"
ENV_FILE="${ROOT_DIR}/.env"
VALIDATOR="${SCRIPT_DIR}/agentbox-config-validate.js"
TUI_READ="${SCRIPT_DIR}/tui-read-manifest.py"
TUI_WRITE="${SCRIPT_DIR}/tui-write-manifest.py"
TMP_DIR="$(mktemp -d)"
STATE_JSON="${TMP_DIR}/state.json"
CANDIDATE_TOML="${TMP_DIR}/candidate.toml"

cleanup() { rm -rf "${TMP_DIR}"; }
trap cleanup EXIT

_WIZARD_PID="$$"
abort_wizard() {
  # Reset terminal in case whiptail left it in cbreak/no-echo mode.
  stty sane 2>/dev/null || true
  # If we're in a subshell (pipeline / $() / function scope inside one),
  # exit alone won't kill the parent script. Signal the main wizard PID,
  # whose own INT/TERM trap will re-enter abort_wizard at the top level.
  if [[ "${BASHPID:-$$}" != "${_WIZARD_PID}" ]]; then
    kill -TERM "${_WIZARD_PID}" 2>/dev/null || true
    exit 130
  fi
  printf '\nWizard aborted by user. No changes written.\n' >&2
  exit 130
}
trap abort_wizard INT TERM

# _wt_run COMMAND...  — invoke a whiptail/dialog command and propagate Ctrl+C.
# Whiptail catches SIGINT itself and exits 130; without this wrapper the parent
# script's `|| true` would swallow it and the wizard would loop forever.
_wt_run() {
  local rc=0
  "$@" || rc=$?
  if [[ "${rc}" == "130" || "${rc}" == "143" ]]; then
    abort_wizard
  fi
  return "${rc}"
}

cd "${ROOT_DIR}"

# ── helpers ────────────────────────────────────────────────────────────────────

command_exists() { command -v "$1" >/dev/null 2>&1; }

detect_pkg_manager() {
  for pm in pacman apt-get dnf zypper; do
    command_exists "${pm}" && echo "${pm%%-get}" && return
  done
  echo ""
}

install_packages() {
  local manager="$1"; shift
  case "${manager}" in
    pacman) sudo pacman -Sy --needed --noconfirm "$@" ;;
    apt)    sudo apt-get update && sudo apt-get install -y "$@" ;;
    dnf)    sudo dnf install -y "$@" ;;
    zypper) sudo zypper --non-interactive install "$@" ;;
    *)      return 1 ;;
  esac
}

ensure_command_with_install() {
  local cmd="$1" hint="$2" pkgs="$3"
  command_exists "${cmd}" && return 0
  echo "Missing required command: ${cmd}"
  read -r -p "Install ${hint}? [Y/n]: " ans
  [[ "${ans,,}" =~ ^(n|no)$ ]] && return 1
  local manager; manager="$(detect_pkg_manager)"
  [[ -z "${manager}" ]] && { echo "No package manager found. Install ${hint} manually."; return 1; }
  # shellcheck disable=SC2206
  install_packages "${manager}" ${pkgs}
  command_exists "${cmd}"
}

ensure_env_file() {
  [[ -f "${ENV_FILE}" ]] && return
  cp "${ENV_EXAMPLE}" "${ENV_FILE}"
  echo "Created ${ENV_FILE} from .env.example"
}

get_env_value() {
  local key="$1"
  [[ -f "${ENV_FILE}" ]] || return
  grep -E "^${key}=" "${ENV_FILE}" | tail -1 | sed "s/^${key}=//" || true
}

set_env_value() {
  local key="$1" value="$2"
  ensure_env_file
  if grep -q -E "^${key}=" "${ENV_FILE}"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "${ENV_FILE}"
  else
    printf "%s=%s\n" "${key}" "${value}" >> "${ENV_FILE}"
  fi
}

# ── state helpers (thin wrappers around JSON) ──────────────────────────────────

state_get() {
  python3 -c "
import json,sys
d=json.load(open(sys.argv[1]))
v=d.get(sys.argv[2])
print('' if v is None else ('true' if v is True else ('false' if v is False else str(v))))
" "${STATE_JSON}" "$1" 2>/dev/null || true
}

state_set() {
  python3 -c "
import json,sys,pathlib
p=pathlib.Path(sys.argv[1])
d=json.loads(p.read_text())
d[sys.argv[2]]=sys.argv[3]
p.write_text(json.dumps(d,indent=2))
" "${STATE_JSON}" "$1" "$2"
}

state_set_bool() {
  python3 -c "
import json,sys,pathlib
p=pathlib.Path(sys.argv[1])
d=json.loads(p.read_text())
d[sys.argv[2]]=(sys.argv[3].lower()=='true')
p.write_text(json.dumps(d,indent=2))
" "${STATE_JSON}" "$1" "$2"
}

# ── whiptail/dialog wrappers ───────────────────────────────────────────────────

detect_tui() { command_exists whiptail && echo whiptail || { command_exists dialog && echo dialog || echo ""; }; }
WT="$(detect_tui)"

wt_menu() {
  # wt_menu TITLE PROMPT HEIGHT WIDTH LISTHEIGHT [TAG ITEM...]
  local title="$1" prompt="$2" h="$3" w="$4" lh="$5"; shift 5
  if [[ -n "${WT}" ]]; then
    _wt_run "${WT}" --title "${title}" --menu "${prompt}" "${h}" "${w}" "${lh}" "$@" 3>&1 1>&2 2>&3 || true
  else
    echo "${prompt}" >&2
    local idx=1 first_tag=""
    local -a tags=()
    while [[ $# -ge 2 ]]; do
      [[ ${idx} -eq 1 ]] && first_tag="$1"
      tags+=("$1")
      echo "  ${idx}) $2" >&2
      shift 2; ((idx++))
    done
    read -r -p "Choice [1]: " choice >&2
    choice="${choice:-1}"
    echo "${tags[$((choice-1))]:-${first_tag}}"
  fi
}

wt_checklist() {
  # wt_checklist TITLE PROMPT HEIGHT WIDTH LISTHEIGHT [TAG ITEM STATUS...]
  local title="$1" prompt="$2" h="$3" w="$4" lh="$5"; shift 5
  if [[ -n "${WT}" ]]; then
    _wt_run "${WT}" --title "${title}" --checklist "${prompt}" "${h}" "${w}" "${lh}" "$@" 3>&1 1>&2 2>&3 | tr -d '"' || true
  else
    echo "${prompt}" >&2
    local -a selected=()
    while [[ $# -ge 3 ]]; do
      local tag="$1" item="$2" state="$3"; shift 3
      read -r -p "  ${item} [${state}]: " ans >&2
      ans="${ans:-${state}}"
      [[ "${ans,,}" =~ ^(on|yes|y|true)$ ]] && selected+=("${tag}")
    done
    echo "${selected[*]}"
  fi
}

wt_inputbox() {
  local title="$1" prompt="$2" h="$3" w="$4" init="$5"
  if [[ -n "${WT}" ]]; then
    _wt_run "${WT}" --title "${title}" --inputbox "${prompt}" "${h}" "${w}" "${init}" 3>&1 1>&2 2>&3 || echo "${init}"
  else
    read -r -p "${prompt} [${init}]: " val >&2
    echo "${val:-${init}}"
  fi
}

wt_passwordbox() {
  local title="$1" prompt="$2" h="$3" w="$4"
  if [[ -n "${WT}" ]]; then
    _wt_run "${WT}" --title "${title}" --passwordbox "${prompt}" "${h}" "${w}" "" 3>&1 1>&2 2>&3 || true
  else
    read -r -s -p "${prompt}: " val >&2; echo >&2
    echo "${val}"
  fi
}

wt_yesno() {
  local title="$1" prompt="$2"
  if [[ -n "${WT}" ]]; then
    _wt_run "${WT}" --title "${title}" --yesno "${prompt}" 8 78 3>&1 1>&2 2>&3
  else
    read -r -p "${prompt} [y/N]: " ans >&2
    [[ "${ans,,}" =~ ^(y|yes)$ ]]
  fi
}

wt_msgbox() {
  local title="$1" msg="$2"
  if [[ -n "${WT}" ]]; then
    _wt_run "${WT}" --title "${title}" --msgbox "${msg}" 20 78 3>&1 1>&2 2>&3 || true
  else
    echo -e "${msg}" >&2
  fi
}

# ── validation helper ──────────────────────────────────────────────────────────
# Writes candidate TOML from current state, runs validator.
# Validator exit code: 0 = clean (warnings allowed on stderr), 1 = errors.
# Returns 0 if validator passed; on errors, shows blocking msgbox + retry.
# On warnings-only, shows an info msgbox but lets the section advance.
validate_candidate() {
  python3 "${TUI_WRITE}" "${STATE_JSON}" "${CANDIDATE_TOML}"
  local stderr_out rc
  stderr_out="$(node "${VALIDATOR}" "${CANDIDATE_TOML}" 2>&1 >/dev/null)" && rc=0 || rc=$?
  if [[ "${rc}" != "0" ]]; then
    wt_msgbox "Validation Errors" \
      "Current selections produced errors. Correct them before proceeding.\n\n${stderr_out}"
    return 1
  fi
  if [[ -n "${stderr_out}" ]]; then
    wt_msgbox "Advisory Warnings" \
      "Validator passed, but raised advisory warnings (W-codes).\nThese are direction signals, not blockers — you can proceed.\n\n${stderr_out}"
  fi
  return 0
}

# ── --validate-only mode ───────────────────────────────────────────────────────
if [[ "${1:-}" == "--validate-only" ]]; then
  if node "${VALIDATOR}" "${CONFIG_FILE}"; then
    exit 0
  else
    exit 1
  fi
fi

# ── context detection ──────────────────────────────────────────────────────────
DETECTED_GPU="none"
command_exists nvidia-smi && DETECTED_GPU="ollama-cuda"
command_exists rocm-smi   && DETECTED_GPU="ollama-rocm"
DETECTED_RAGFLOW=false
docker network ls 2>/dev/null | grep -q visionclaw_network && DETECTED_RAGFLOW=true

# CPU / RAM capability probe for the privacy filter sidecar.
# MoE weights (~3 GB BF16) stay resident even though only 50M params fire per
# token, so a realistic CPU path needs ≥4 cores and ≥6 GB MemAvailable.
DETECTED_CORES="$(nproc 2>/dev/null || echo 1)"
DETECTED_MEM_MB=0
if [[ -r /proc/meminfo ]]; then
  DETECTED_MEM_MB=$(awk '/^MemAvailable:/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)
fi
HAS_PRIVACY_CAPABLE=false
if [[ "${DETECTED_GPU}" != "none" ]]; then
  HAS_PRIVACY_CAPABLE=true
elif (( DETECTED_CORES >= 4 )) && (( DETECTED_MEM_MB >= 6144 )); then
  HAS_PRIVACY_CAPABLE=true
fi

# ── ensure whiptail available ──────────────────────────────────────────────────
if [[ -z "${WT}" ]]; then
  ensure_command_with_install whiptail "whiptail/newt" "libnewt whiptail newt dialog" || true
  WT="$(detect_tui)"
fi

# ── load existing manifest → state.json ───────────────────────────────────────
python3 "${TUI_READ}" "${CONFIG_FILE}" "${STATE_JSON}"
# Apply detected GPU default only when manifest currently has "none"
[[ "$(state_get 'gpu.backend')" == "none" ]] && state_set "gpu.backend" "${DETECTED_GPU}"

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 1 — federation
# ════════════════════════════════════════════════════════════════════════════════
section_federation() {
  local current; current="$(state_get 'federation.mode')"
  local choice
  choice="$(wt_menu \
    "Federation" "Deployment shape — how does this instance relate to a host mesh?" \
    12 72 2 \
    "standalone" "All services run locally (self-contained)" \
    "client"     "Federate with a host container mesh via external adapters")"
  [[ -z "${choice}" ]] && choice="${current}"
  state_set "federation.mode" "${choice}"

  if [[ "${choice}" == "client" ]]; then
    local url
    url="$(wt_inputbox "Federation — External URL" \
      "Host mesh base URL (e.g. http://host-orchestrator:7070)" \
      9 78 "$(state_get 'federation.external_url')")"
    state_set "federation.external_url" "${url}"
  fi
  validate_candidate
}

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 2 — adapters (one menu per slot)
# ════════════════════════════════════════════════════════════════════════════════
section_adapters() {
  declare -A SLOT_DESC=(
    [beads]="Structured agent-work receipts"
    [pods]="Durable linked-data storage"
    [memory]="Vector memory"
    [events]="Agent lifecycle event sink"
    [orchestrator]="Agent spawn and monitor channel"
  )
  declare -A SLOT_VALUES=(
    [beads]="local-sqlite external off"
    [pods]="local-solid-rs local-jss external off"
    [memory]="embedded-ruvector external-pg off"
    [events]="local-jsonl external off"
    [orchestrator]="local-process-manager stdio-bridge off"
  )

  for slot in beads pods memory events orchestrator; do
    local current; current="$(state_get "adapters.${slot}")"
    local -a menu_args=()
    for v in ${SLOT_VALUES[${slot}]}; do
      menu_args+=("${v}" "${v}")
    done
    local choice
    choice="$(wt_menu \
      "Adapters — ${slot}" "${SLOT_DESC[${slot}]}\nCurrent: ${current}" \
      12 72 3 "${menu_args[@]}")"
    [[ -n "${choice}" ]] && state_set "adapters.${slot}" "${choice}"
  done
  validate_candidate
}

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 3 — gpu
# ════════════════════════════════════════════════════════════════════════════════
section_gpu() {
  local current; current="$(state_get 'gpu.backend')"
  local choice
  choice="$(wt_menu \
    "GPU Backend" "Select GPU acceleration (detected: ${DETECTED_GPU})" \
    12 72 4 \
    "none"         "No GPU sidecar — CPU-only" \
    "ollama-rocm"  "Ollama — ROCm/Vulkan (/dev/kfd + /dev/dri)" \
    "ollama-cuda"  "Ollama — NVIDIA container runtime" \
    "local-cuda"   "CUDA baked into image (required for gaussian_splatting)")"
  [[ -z "${choice}" ]] && choice="${current}"
  state_set "gpu.backend" "${choice}"
  validate_candidate
}

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 7a — consultant tier (PRD-005 / ADR-011)
# Surfaced AFTER providers + toolchains so the dependencies the validator
# enforces (E035 provider gate, E037 toolchain gate) are already in scope.
# ════════════════════════════════════════════════════════════════════════════════
section_consultants() {
  if ! wt_yesno "Consultant tier (PRD-005 / ADR-011)" \
    "Enable the consultant tier?\n\nFive MCP servers expose external LLM providers as named consultants the\ncoordinator can invoke explicitly: codex (OpenAI Codex CLI), antigravity\n(Google agy CLI), zai (Z.AI / GLM-5), perplexity (live web), and\ndeepseek (math + reasoning).\n\nManual call from chat:  /consult <name> \"<question>\"\nAuto dispatch:           subagent_type=\"auto-consultant\"\n\nLogs land in /var/lib/agentbox/consultations/<name>-YYYY-MM-DD.jsonl;\nsetting intelligence_signal=true also writes ADR-043 quality signals\nfor SONA learning."; then
    state_set_bool "consultants.enabled" "false"
    return 0
  fi

  state_set_bool "consultants.enabled" "true"

  local raw
  raw="$(wt_checklist "Consultant tier — providers to enable" \
    "Pick which consultants to ship (each requires its matching\nproviders.<name>=true and the relevant CLI toolchain)" \
    18 78 5 \
    "consultants.codex.enabled"      "OpenAI Codex Rust CLI (toolchains.codex)"          "$([[ "$(state_get consultants.codex.enabled)" == "true" ]] && echo ON || echo OFF)" \
    "consultants.antigravity.enabled" "Google Antigravity agy (toolchains.antigravity_cli)" "$([[ "$(state_get consultants.antigravity.enabled)" == "true" ]] && echo ON || echo OFF)" \
    "consultants.zai.enabled"        "Z.AI / GLM-5 via claude-zai (providers.zai)"        "$([[ "$(state_get consultants.zai.enabled)" == "true" ]] && echo ON || echo OFF)" \
    "consultants.perplexity.enabled" "Perplexity (providers.perplexity)"                  "$([[ "$(state_get consultants.perplexity.enabled)" == "true" ]] && echo ON || echo OFF)" \
    "consultants.deepseek.enabled"   "DeepSeek (providers.deepseek)"                      "$([[ "$(state_get consultants.deepseek.enabled)" == "true" ]] && echo ON || echo OFF)")"

  for k in consultants.codex.enabled consultants.antigravity.enabled consultants.zai.enabled consultants.perplexity.enabled consultants.deepseek.enabled; do
    if echo "${raw}" | grep -qw "${k}"; then
      state_set_bool "${k}" "true"
    else
      state_set_bool "${k}" "false"
    fi
  done

  # Cascade: enabling a consultant requires its matching provider (E035) and,
  # for the CLI-spawning consultants, its matching toolchain (E037). Set both
  # automatically in state so the wizard's own validate_candidate pass stays
  # green; the providers section that follows still prompts for the API key
  # so E017 (env var present) is satisfied at boot.
  declare -A _cons_to_provider=(
    [consultants.codex.enabled]=providers.openai.enabled
    [consultants.antigravity.enabled]=providers.gemini.enabled
    [consultants.zai.enabled]=providers.zai.enabled
    [consultants.perplexity.enabled]=providers.perplexity.enabled
    [consultants.deepseek.enabled]=providers.deepseek.enabled
  )
  declare -A _cons_to_toolchain=(
    [consultants.codex.enabled]=toolchains.codex
    [consultants.antigravity.enabled]=toolchains.antigravity_cli
  )
  local cascaded=()
  for cons_key in "${!_cons_to_provider[@]}"; do
    if [[ "$(state_get "${cons_key}")" == "true" ]]; then
      local prov="${_cons_to_provider[${cons_key}]}"
      if [[ "$(state_get "${prov}")" != "true" ]]; then
        state_set_bool "${prov}" "true"
        cascaded+=("${prov}")
      fi
      local tc="${_cons_to_toolchain[${cons_key}]:-}"
      if [[ -n "${tc}" && "$(state_get "${tc}")" != "true" ]]; then
        state_set_bool "${tc}" "true"
        cascaded+=("${tc}")
      fi
    fi
  done
  if [[ ${#cascaded[@]} -gt 0 ]]; then
    wt_msgbox "Consultant tier — cascaded dependencies" \
      "The following gates were turned ON automatically because the\nconsultants you selected depend on them:\n\n  $(printf '%s\n  ' "${cascaded[@]}")\nYou will be prompted for any missing API keys in the\n[providers] section later in the wizard."
  fi

  if wt_yesno "Consultant tier — intelligence signals" \
    "Write ADR-043 QualitySignal files for every successful consultation?\n\nThis lets the SONA learning loop absorb consultation outcomes (which\nconsultant was chosen, latency, cost, success/failure) so the\nauto-consultant classifier improves over time. Files land under\n/workspace/profiles/<stack>/intelligence/data/."; then
    state_set_bool "consultants.intelligence_signal" "true"
  else
    state_set_bool "consultants.intelligence_signal" "false"
  fi

  validate_candidate
}

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 3b — privacy filter (ADR-008)
# Skipped entirely when the host cannot realistically run the sidecar.
# ════════════════════════════════════════════════════════════════════════════════
section_privacy_filter() {
  if [[ "${HAS_PRIVACY_CAPABLE}" != "true" ]]; then
    state_set_bool "privacy_filter.enabled" "false"
    state_set "privacy_filter.mode" "off"
    return 0
  fi

  local cap_msg
  if [[ "${DETECTED_GPU}" != "none" ]]; then
    cap_msg="GPU detected (${DETECTED_GPU}) — local-gpu path available (BF16)."
  else
    cap_msg="No GPU. CPU path viable: ${DETECTED_CORES} cores, ${DETECTED_MEM_MB} MB free RAM."
  fi

  if ! wt_yesno "Privacy Filter (openai/privacy-filter)" \
    "Offer a local PII redaction sidecar for adapter writes?\n\n${cap_msg}\n\nThe sidecar masks names, emails, phones, addresses, dates,\naccount numbers, URLs and secrets before agent I/O hits\ndurable state (pods, memory, events, beads) or the\ninbound/outbound prompt path.\n\nApache-2.0, 1.5B MoE (50M active), runs loopback-only."; then
    state_set_bool "privacy_filter.enabled" "false"
    state_set "privacy_filter.mode" "off"
    validate_candidate
    return 0
  fi

  state_set_bool "privacy_filter.enabled" "true"

  # Mode — auto-prefer GPU when present, allow override.
  local default_mode
  if [[ "${DETECTED_GPU}" != "none" ]]; then default_mode="local-gpu"; else default_mode="local-cpu"; fi
  local mode_choice
  mode_choice="$(wt_menu "Privacy Filter — Mode" \
    "How should the sidecar load the model?" \
    11 72 2 \
    "local-gpu" "CUDA/ROCm (fast; BF16)" \
    "local-cpu" "CPU-only (BF16; ~3 GB RAM resident)")"
  [[ -z "${mode_choice}" ]] && mode_choice="${default_mode}"
  state_set "privacy_filter.mode" "${mode_choice}"

  # dtype — q4 only meaningful on CPU.
  local dtype_choice
  if [[ "${mode_choice}" == "local-cpu" ]]; then
    dtype_choice="$(wt_menu "Privacy Filter — Precision" \
      "Inference precision (CPU)" \
      11 72 3 \
      "bf16" "BF16 (recommended; ~3 GB)" \
      "f32"  "FP32 (debug; ~6 GB)" \
      "q4"   "Q4 quantised (smallest; CPU-only)")"
  else
    dtype_choice="$(wt_menu "Privacy Filter — Precision" \
      "Inference precision (GPU)" \
      10 72 2 \
      "bf16" "BF16 (recommended)" \
      "f32"  "FP32 (debug)")"
  fi
  [[ -z "${dtype_choice}" ]] && dtype_choice="bf16"
  state_set "privacy_filter.dtype" "${dtype_choice}"

  # Policy preset — strict-everywhere | balanced (default) | custom.
  local preset
  preset="$(wt_menu "Privacy Filter — Policy Preset" \
    "How aggressively should the middleware redact?\n\nstrict: reject write if redaction fails (fail-closed)\nsoft:   best-effort, log on failure (fail-open)\noff:    pass-through for that slot" \
    14 76 3 \
    "balanced" "pods/memory=strict, events/beads=soft, orch=off" \
    "lockdown" "all slots = strict (fail-closed everywhere)" \
    "custom"   "per-slot choice")"
  [[ -z "${preset}" ]] && preset="balanced"

  if [[ "${preset}" == "lockdown" ]]; then
    for k in pods memory events beads orchestrator inbound outbound; do
      state_set "privacy_filter.policy.${k}" "strict"
    done
  elif [[ "${preset}" == "custom" ]]; then
    for slot in pods memory events beads orchestrator inbound outbound; do
      local cur; cur="$(state_get "privacy_filter.policy.${slot}")"
      local v
      v="$(wt_menu "Privacy Filter — ${slot}" \
        "Redaction policy for ${slot}\nCurrent: ${cur}" \
        11 64 3 \
        "strict" "fail-closed; reject on router error" \
        "soft"   "fail-open; log-and-continue" \
        "off"    "pass-through")"
      [[ -n "${v}" ]] && state_set "privacy_filter.policy.${slot}" "${v}"
    done
  else
    # balanced — use manifest defaults already loaded by tui-read.
    :
  fi

  validate_candidate
}

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 4 — desktop
# ════════════════════════════════════════════════════════════════════════════════
section_desktop() {
  if wt_yesno "Desktop" "Enable desktop environment (VNC/Wayland stack)?"; then
    state_set_bool "desktop.enabled" "true"
    local stack_choice
    stack_choice="$(wt_menu "Desktop — Stack" "Choose the desktop compositor" \
      10 72 2 \
      "hyprland-wayland" "Hyprland (Wayland, recommended)" \
      "x11-openbox"      "Openbox (X11, lower resources)")"
    [[ -n "${stack_choice}" ]] && state_set "desktop.stack" "${stack_choice}"
    local res
    res="$(wt_inputbox "Desktop — Resolution" "Display resolution (WxH)" \
      9 50 "$(state_get 'desktop.resolution')")"
    [[ -n "${res}" ]] && state_set "desktop.resolution" "${res}"
  else
    state_set_bool "desktop.enabled" "false"
  fi
  validate_candidate
}

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 5 — toolchains
# ════════════════════════════════════════════════════════════════════════════════
section_toolchains() {
  on_off() { [[ "$(state_get "$1")" == "true" ]] && echo "ON" || echo "OFF"; }

  local raw
  raw="$(wt_checklist "Toolchains" "Select toolchains to install" \
    22 78 12 \
    "toolchains.claude"          "Claude CLI"             "$(on_off toolchains.claude)" \
    "toolchains.claude_code"     "Claude Code"            "$(on_off toolchains.claude_code)" \
    "toolchains.ruflo"           "Ruflo orchestrator"     "$(on_off toolchains.ruflo)" \
    "toolchains.claude_flow"     "Claude Flow v3"         "$(on_off toolchains.claude_flow)" \
    "toolchains.agentic_qe"      "Agentic QE"             "$(on_off toolchains.agentic_qe)" \
    "toolchains.nagual_qe"       "Nagual QE"              "$(on_off toolchains.nagual_qe)" \
    "toolchains.antigravity_cli" "Antigravity CLI (agy)"  "$(on_off toolchains.antigravity_cli)" \
    "toolchains.codex"           "OpenAI Codex Rust CLI"  "$(on_off toolchains.codex)" \
    "toolchains.code_server"     "code-server (VS Code)"  "$(on_off toolchains.code_server)" \
    "toolchains.codebase_memory" "Codebase Memory MCP"    "$(on_off toolchains.codebase_memory)" \
    "toolchains.rust"            "Rust toolchain"         "$(on_off toolchains.rust)" \
    "toolchains.cuda"            "CUDA toolchain"         "$(on_off toolchains.cuda)")"

  for key in toolchains.claude toolchains.claude_code toolchains.ruflo toolchains.claude_flow \
             toolchains.agentic_qe toolchains.nagual_qe toolchains.antigravity_cli toolchains.codex \
             toolchains.code_server toolchains.codebase_memory toolchains.rust toolchains.cuda; do
    if echo "${raw}" | grep -qw "${key}"; then
      state_set_bool "${key}" "true"
    else
      state_set_bool "${key}" "false"
    fi
  done
  validate_candidate
}

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 6 — skills (five grouped checklists)
# ════════════════════════════════════════════════════════════════════════════════
section_skills() {
  on_off() { [[ "$(state_get "$1")" == "true" ]] && echo "ON" || echo "OFF"; }

  # Browser skills
  local raw_br
  raw_br="$(wt_checklist "Skills — Browser" "Browser automation" 14 78 3 \
    "skills.browser.agent_browser" "Agent Browser"  "$(on_off skills.browser.agent_browser)" \
    "skills.browser.playwright"    "Playwright"     "$(on_off skills.browser.playwright)" \
    "skills.browser.qe_browser"    "QE Browser"     "$(on_off skills.browser.qe_browser)")"
  for k in skills.browser.agent_browser skills.browser.playwright skills.browser.qe_browser; do
    echo "${raw_br}" | grep -qw "${k}" && state_set_bool "${k}" "true" || state_set_bool "${k}" "false"
  done

  # Media skills
  local raw_md
  raw_md="$(wt_checklist "Skills — Media" "Media processing" 14 78 3 \
    "skills.media.ffmpeg"          "FFmpeg"                       "$(on_off skills.media.ffmpeg)" \
    "skills.media.imagemagick"     "ImageMagick"                  "$(on_off skills.media.imagemagick)" \
    "skills.media.comfyui_builtin" "ComfyUI built-in (port 8188)" "$(on_off skills.media.comfyui_builtin)")"
  for k in skills.media.ffmpeg skills.media.imagemagick skills.media.comfyui_builtin; do
    echo "${raw_md}" | grep -qw "${k}" && state_set_bool "${k}" "true" || state_set_bool "${k}" "false"
  done

  # Spatial + 3D
  local raw_3d
  raw_3d="$(wt_checklist "Skills — Spatial & 3D" "Spatial and 3D tools" 14 78 3 \
    "skills.spatial_and_3d.blender"            "Blender"                         "$(on_off skills.spatial_and_3d.blender)" \
    "skills.spatial_and_3d.qgis"               "QGIS"                            "$(on_off skills.spatial_and_3d.qgis)" \
    "skills.spatial_and_3d.gaussian_splatting" "Gaussian Splatting (needs CUDA)" "$(on_off skills.spatial_and_3d.gaussian_splatting)")"
  for k in skills.spatial_and_3d.blender skills.spatial_and_3d.qgis skills.spatial_and_3d.gaussian_splatting; do
    echo "${raw_3d}" | grep -qw "${k}" && state_set_bool "${k}" "true" || state_set_bool "${k}" "false"
  done

  # Data science
  local raw_ds
  raw_ds="$(wt_checklist "Skills — Data Science" "ML and notebooks" 12 78 2 \
    "skills.data_science.pytorch" "PyTorch"           "$(on_off skills.data_science.pytorch)" \
    "skills.data_science.jupyter" "Jupyter notebooks" "$(on_off skills.data_science.jupyter)")"
  for k in skills.data_science.pytorch skills.data_science.jupyter; do
    echo "${raw_ds}" | grep -qw "${k}" && state_set_bool "${k}" "true" || state_set_bool "${k}" "false"
  done

  # Docs + ontology
  local raw_doc
  raw_doc="$(wt_checklist "Skills — Docs & Ontology" "Documentation and ontology" 15 78 4 \
    "skills.docs.latex"          "LaTeX toolchain"    "$(on_off skills.docs.latex)" \
    "skills.docs.mermaid"        "Mermaid CLI"        "$(on_off skills.docs.mermaid)" \
    "skills.docs.report_builder" "Report builder"     "$(on_off skills.docs.report_builder)" \
    "skills.ontology.enabled"    "Ontology (OWL2 DL)" "$(on_off skills.ontology.enabled)")"
  for k in skills.docs.latex skills.docs.mermaid skills.docs.report_builder skills.ontology.enabled; do
    echo "${raw_doc}" | grep -qw "${k}" && state_set_bool "${k}" "true" || state_set_bool "${k}" "false"
  done

  validate_candidate
}

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 7 — providers (checklist + per-provider key prompt)
# ════════════════════════════════════════════════════════════════════════════════
section_providers() {
  on_off() { [[ "$(state_get "$1")" == "true" ]] && echo "ON" || echo "OFF"; }

  local raw_prov
  raw_prov="$(wt_checklist "Providers" "Enable API providers (keys collected next)" \
    22 78 10 \
    "anthropic"  "Anthropic (Claude)"  "$(on_off providers.anthropic.enabled)" \
    "openai"     "OpenAI"              "$(on_off providers.openai.enabled)" \
    "gemini"     "Google Gemini"       "$(on_off providers.gemini.enabled)" \
    "deepseek"   "DeepSeek"            "$(on_off providers.deepseek.enabled)" \
    "perplexity" "Perplexity"          "$(on_off providers.perplexity.enabled)" \
    "openrouter" "OpenRouter"          "$(on_off providers.openrouter.enabled)" \
    "context7"   "Context7"            "$(on_off providers.context7.enabled)" \
    "brave"      "Brave Search"        "$(on_off providers.brave.enabled)" \
    "github"     "GitHub"              "$(on_off providers.github.enabled)" \
    "zai"        "Z.AI"                "$(on_off providers.zai.enabled)")"

  declare -A PROV_ENV=(
    [anthropic]="ANTHROPIC_API_KEY"
    [openai]="OPENAI_API_KEY"
    [gemini]="GOOGLE_GEMINI_API_KEY"
    [deepseek]="DEEPSEEK_API_KEY"
    [perplexity]="PERPLEXITY_API_KEY"
    [openrouter]="OPENROUTER_API_KEY"
    [context7]="CONTEXT7_API_KEY"
    [brave]="BRAVE_API_KEY"
    [github]="GITHUB_TOKEN"
    [zai]="ZAI_API_KEY"
  )

  # Providers whose CLI ships a web sign-in / OAuth flow. The wizard offers
  # an "OAuth" branch for these; the validator's W040 list must stay in sync.
  declare -A OAUTH_CAPABLE=( [anthropic]=1 [openai]=1 [zai]=1 )
  declare -A OAUTH_HINT=(
    [anthropic]="Run \`claude login\` inside the container after first boot.\nThe Claude Code CLI completes an OAuth handshake in your browser\nand stores the session token under /home/devuser/.claude/."
    [openai]="Run \`codex login\` inside the container after first boot.\nThe Codex Rust CLI completes an OAuth handshake in your browser\nand stores credentials under /home/openai-user/.codex/auth.json."
    [zai]="Run \`claude-zai login\` (or \`zai-cli login\`) inside the container\nafter first boot. The Z.AI / GLM wrapper opens a browser session\nand persists tokens under /home/zai-user/.zai/."
  )

  for pname in anthropic openai gemini deepseek perplexity openrouter context7 brave github zai; do
    if echo "${raw_prov}" | grep -qw "${pname}"; then
      state_set_bool "providers.${pname}.enabled" "true"
      local env_var="${PROV_ENV[${pname}]}"
      local current_val; current_val="$(get_env_value "${env_var}")"

      # Auth-mode branch: API key vs web sign-in. Only offered for providers
      # whose CLI actually has an OAuth flow.
      local auth_mode="api_key"
      if [[ -n "${OAUTH_CAPABLE[${pname}]:-}" ]]; then
        local prev_mode; prev_mode="$(state_get providers.${pname}.auth_mode)"
        [[ -z "${prev_mode}" ]] && prev_mode="api_key"
        auth_mode="$(wt_menu "Provider: ${pname} — credentials" \
          "How do you want to authenticate with ${pname}?\n\nAPI key: paste a key now; written to .env." \
          12 78 2 \
          "api_key" "API key (paste $(echo "${env_var}") now)" \
          "oauth"   "Web sign-in (\`${pname}\` CLI handles login)")"
        [[ -z "${auth_mode}" ]] && auth_mode="${prev_mode}"
      fi
      state_set "providers.${pname}.auth_mode" "${auth_mode}"

      if [[ "${auth_mode}" == "oauth" ]]; then
        wt_msgbox "Provider: ${pname} — web sign-in selected" \
          "auth_mode=oauth — no API key required.\n\n$(echo -e "${OAUTH_HINT[${pname}]}")\n\nIf you also have ${env_var} in .env, the CLI will\nuse the OAuth session anyway (CLI precedence)."
        # Don't write/clear the env var — leave any existing value alone so the
        # user can switch back to api_key without re-typing it.
      else
        local hint="${env_var}"
        [[ -n "${current_val}" ]] && hint="${env_var} (currently set — leave blank to keep)"
        local secret
        secret="$(wt_passwordbox "Provider: ${pname}" "Enter ${hint}" 9 78)"
        if [[ -n "${secret}" ]]; then
          set_env_value "${env_var}" "${secret}"
        elif [[ -z "${current_val}" ]]; then
          wt_msgbox "Provider warning" \
            "No value entered for ${env_var}.\nProvider '${pname}' will fail E017 at boot unless added to .env manually,\nor change auth_mode to oauth (anthropic / openai only)."
        fi
      fi
    else
      state_set_bool "providers.${pname}.enabled" "false"
    fi
  done

  # Infrastructure env vars (not provider-gated, always present)
  for kv_pair in "MANAGEMENT_API_KEY:Management API key" \
                 "AGENTBOX_AGENT_ID:Agent identity name" \
                 "NOSTR_RELAYS:Comma-separated Nostr relay URLs"; do
    local ekey="${kv_pair%%:*}" elabel="${kv_pair##*:}"
    local cur; cur="$(get_env_value "${ekey}")"
    if wt_yesno "Environment — ${ekey}" "Edit ${ekey}?\nCurrent: ${cur:-<not set>}"; then
      local val
      val="$(wt_inputbox "Environment — ${ekey}" "${elabel}" 9 78 "${cur}")"
      [[ -n "${val}" ]] && set_env_value "${ekey}" "${val}"
    fi
  done

  # Source .env so validator can see E017 keys
  [[ -f "${ENV_FILE}" ]] && set -a && source "${ENV_FILE}" && set +a 2>/dev/null || true
  validate_candidate
}

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 7b — operator Nostr identity
#
# Asks the operator whether they already have a Nostr keypair. If yes, captures
# the public key (npub bech32 or 64-char hex) and optional display name.
# If no, explains that a fresh identity will be auto-generated at first boot
# by sovereign-bootstrap.py.
#
# Values are written to:
#   agentbox.toml  → [sovereign_mesh.operator] pubkey_hex / npub / display_name
#   .env           → OPERATOR_NOSTR_PUBKEY
#
# The PRIVATE key is NEVER stored in agentbox.toml. If the operator needs to
# sign events, they pass OPERATOR_NOSTR_PRIVKEY via .env or use NIP-07/NIP-46
# remote signing at runtime.
# ════════════════════════════════════════════════════════════════════════════════

# Globals populated by section_operator_identity and consumed after final write.
_OPERATOR_PUBKEY_HEX=""
_OPERATOR_NPUB=""
_OPERATOR_DISPLAY_NAME=""

# _validate_nostr_pubkey VALUE
# Returns 0 and prints the normalised form if VALUE is a valid npub1… bech32
# string or a 64-character lowercase hex string. Returns 1 otherwise.
_validate_nostr_pubkey() {
  local val="$1"
  # npub bech32: starts with npub1, 59-64 chars total (spec: 63 chars)
  if [[ "${val}" =~ ^npub1[0-9a-zA-Z]{58,63}$ ]]; then
    echo "${val}"
    return 0
  fi
  # 64-char hex (case-insensitive input, normalise to lowercase)
  local lower="${val,,}"
  if [[ "${lower}" =~ ^[0-9a-f]{64}$ ]]; then
    echo "${lower}"
    return 0
  fi
  return 1
}

section_operator_identity() {
  # ── intro message ──────────────────────────────────────────────────────
  wt_msgbox "Operator Nostr Identity" \
    "Your Nostr public key identifies you as the operator of this agentbox.\n\n\
It is used to:\n\
  - Grant you operator-level access to the management API (NIP-98)\n\
  - Add you to the embedded relay's allowlist\n\
  - Tag you as the delegator on NIP-26 agent delegations\n\
  - Set you as the WebID owner in Solid pod ACLs\n\n\
Your private key is NEVER stored in agentbox.toml.\n\n\
If you do not have a Nostr identity yet, you can get one free at\n\
https://iris.to, https://primal.net, or any Nostr client."

  # ── do you already have one? ───────────────────────────────────────────
  if wt_yesno "Operator Identity" \
    "Do you already have a Nostr identity?\n\n\
Choose YES to enter your npub or hex public key now.\n\
Choose NO to auto-generate a fresh identity at first boot."; then

    # ── collect pubkey with format validation loop ─────────────────────
    local pubkey="" validated=""
    while true; do
      pubkey="$(wt_inputbox "Operator — Public Key" \
        "Enter your Nostr public key.\n\n\
Format: npub1... (bech32) or 64-character hex string\n\
Example: npub1qqqq...xyz  or  a1b2c3d4...64 hex chars" \
        12 78 "")"

      # Empty input — treat as skip
      if [[ -z "${pubkey}" ]]; then
        wt_msgbox "Operator Identity — Skipped" \
          "No public key entered.\nA fresh identity will be auto-generated at first boot."
        _OPERATOR_PUBKEY_HEX=""
        _OPERATOR_NPUB=""
        break
      fi

      validated="$(_validate_nostr_pubkey "${pubkey}")" && break

      # Validation failed — show error and retry
      wt_msgbox "Invalid Public Key" \
        "\"${pubkey}\" is not a valid Nostr public key.\n\n\
Accepted formats:\n\
  - npub1… (bech32-encoded, ~63 characters)\n\
  - 64-character lowercase hex string\n\n\
Please try again, or leave the field blank to skip."
    done

    if [[ -n "${validated}" ]]; then
      if [[ "${validated}" =~ ^npub1 ]]; then
        _OPERATOR_NPUB="${validated}"
        _OPERATOR_PUBKEY_HEX=""
      else
        _OPERATOR_PUBKEY_HEX="${validated}"
        _OPERATOR_NPUB=""
      fi

      # Write to .env so the runtime can pick it up immediately
      set_env_value "OPERATOR_NOSTR_PUBKEY" "${validated}"
    fi
  else
    # No existing identity — auto-generation at first boot
    wt_msgbox "Operator Identity — Auto-Generate" \
      "A fresh Nostr identity will be generated at first boot by\n\
sovereign-bootstrap.py. The keypair will be stored in the\n\
container's secure keystore, and the public key written to\n\
agentbox.toml automatically.\n\n\
You can always set it manually later by editing:\n\
  [sovereign_mesh.operator] in agentbox.toml\n\
  OPERATOR_NOSTR_PUBKEY in .env"
    _OPERATOR_PUBKEY_HEX=""
    _OPERATOR_NPUB=""
  fi

  # ── optional display name ──────────────────────────────────────────────
  local current_name; current_name="$(state_get 'sovereign_mesh.operator.display_name')"
  _OPERATOR_DISPLAY_NAME="$(wt_inputbox "Operator — Display Name (optional)" \
    "A human-readable name used in event tags and the management API.\nLeave blank to omit." \
    9 78 "${current_name}")"

  # Store in state so the summary preview can show them (even though
  # tui-write does not emit [sovereign_mesh.operator] — we patch after).
  state_set "sovereign_mesh.operator.pubkey_hex"  "${_OPERATOR_PUBKEY_HEX}"
  state_set "sovereign_mesh.operator.npub"        "${_OPERATOR_NPUB}"
  state_set "sovereign_mesh.operator.display_name" "${_OPERATOR_DISPLAY_NAME}"
}

# _patch_operator_toml FILE
# Inserts or updates the [sovereign_mesh.operator] block in the given TOML file.
# Called after tui-write produces the candidate, since tui-write does not emit
# operator fields.
_patch_operator_toml() {
  local file="$1"
  local hex="${_OPERATOR_PUBKEY_HEX}"
  local npub="${_OPERATOR_NPUB}"
  local name="${_OPERATOR_DISPLAY_NAME}"

  # Build the block
  local block
  block="$(printf '\n[sovereign_mesh.operator]\npubkey_hex   = "%s"\nnpub         = "%s"\ndisplay_name = "%s"\nrelay_urls   = []\n' \
    "${hex}" "${npub}" "${name}")"

  # If the section already exists, replace it; otherwise insert after [sovereign_mesh]
  if grep -q '^\[sovereign_mesh\.operator\]' "${file}" 2>/dev/null; then
    # Remove existing block (from header to next section or EOF)
    python3 -c "
import re, pathlib, sys
p = pathlib.Path(sys.argv[1])
text = p.read_text()
# Match [sovereign_mesh.operator] through to the next [...] header or EOF
text = re.sub(
    r'\n?\[sovereign_mesh\.operator\]\n(?:(?!\[)[^\n]*\n)*',
    '',
    text,
)
p.write_text(text)
" "${file}"
  fi
  # Insert after the [sovereign_mesh] block's last key line
  python3 -c "
import pathlib, sys
p = pathlib.Path(sys.argv[1])
text = p.read_text()
block = sys.argv[2]
# Find [sovereign_mesh] section and insert operator block after its last key
idx = text.find('[sovereign_mesh]')
if idx == -1:
    # Append at end
    text += block + '\n'
else:
    # Find the blank line or next section after [sovereign_mesh]
    rest = text[idx + len('[sovereign_mesh]'):]
    # Walk past key=value lines
    import re
    m = re.search(r'\n(?=\n|\[)', rest)
    if m:
        insert_pos = idx + len('[sovereign_mesh]') + m.start()
        text = text[:insert_pos] + block + text[insert_pos:]
    else:
        text += block + '\n'
p.write_text(text)
" "${file}" "${block}"
}

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 8 — observability
# ════════════════════════════════════════════════════════════════════════════════
section_observability() {
  local port
  port="$(wt_inputbox "Observability — Metrics Port" \
    "Prometheus /metrics port (default 9091; must not clash with 5901/8080/8484/9090)" \
    9 70 "$(state_get 'observability.metrics_port')")"
  [[ -n "${port}" ]] && state_set "observability.metrics_port" "${port}"

  local otlp
  otlp="$(wt_inputbox "Observability — OTLP Endpoint" \
    "OpenTelemetry OTLP endpoint (leave empty to drop traces)" \
    9 78 "$(state_get 'observability.otlp_endpoint')")"
  state_set "observability.otlp_endpoint" "${otlp}"

  local level
  level="$(wt_menu "Observability — Log Level" "Structured log verbosity" \
    12 60 5 \
    "trace" "trace — most verbose" \
    "debug" "debug" \
    "info"  "info  (default)" \
    "warn"  "warn" \
    "error" "error — least verbose")"
  [[ -n "${level}" ]] && state_set "observability.log_level" "${level}"

  validate_candidate
}

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 9 — integrations
# ════════════════════════════════════════════════════════════════════════════════
section_integrations() {
  # RagFlow — only offered when visionclaw_network network is detected
  if [[ "${DETECTED_RAGFLOW}" == "true" ]]; then
    if wt_yesno "Integrations — RagFlow" \
      "visionclaw_network network detected. Enable [integrations.ragflow]?"; then
      state_set_bool "integrations.ragflow.enabled" "true"
    else
      state_set_bool "integrations.ragflow.enabled" "false"
    fi
  fi

  # ComfyUI external — mutually exclusive with comfyui_builtin (E007)
  if [[ "$(state_get 'skills.media.comfyui_builtin')" == "true" ]]; then
    wt_msgbox "ComfyUI" \
      "skills.media.comfyui_builtin is enabled.\nExternal ComfyUI is mutually exclusive (E007) — skipping."
    state_set_bool "integrations.comfyui_external.enabled" "false"
  else
    if wt_yesno "Integrations — ComfyUI External" \
      "Connect to an external pre-existing ComfyUI instance?"; then
      state_set_bool "integrations.comfyui_external.enabled" "true"
      local curi
      curi="$(wt_inputbox "ComfyUI — HTTP URL" "Base HTTP URL" 9 78 \
        "$(state_get 'integrations.comfyui_external.url')")"
      [[ -n "${curi}" ]] && state_set "integrations.comfyui_external.url" "${curi}"
      local cwsurl
      cwsurl="$(wt_inputbox "ComfyUI — WebSocket URL" "WS URL" 9 78 \
        "$(state_get 'integrations.comfyui_external.ws_url')")"
      [[ -n "${cwsurl}" ]] && state_set "integrations.comfyui_external.ws_url" "${cwsurl}"
    else
      state_set_bool "integrations.comfyui_external.enabled" "false"
    fi
  fi

  # RuVector external — only surfaced when adapters.memory=external-pg
  if [[ "$(state_get 'adapters.memory')" == "external-pg" ]]; then
    local conninfo
    conninfo="$(wt_inputbox "Integrations — RuVector External" \
      "PostgreSQL DSN (required for adapters.memory=external-pg)" \
      9 78 "$(state_get 'integrations.ruvector_external.conninfo')")"
    [[ -n "${conninfo}" ]] && state_set "integrations.ruvector_external.conninfo" "${conninfo}"
    state_set_bool "integrations.ruvector_external.enabled" "true"
  fi

  validate_candidate
}

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 9b — embedded Nostr relay (PRD-004 / ADR-009)
# Only surfaced when sovereign_mesh.enabled OR sovereign_mesh.solid_pod (E026).
# ════════════════════════════════════════════════════════════════════════════════
section_nostr_relay() {
  local sm_enabled sp_enabled
  sm_enabled="$(state_get 'sovereign_mesh.enabled')"
  sp_enabled="$(state_get 'sovereign_mesh.solid_pod')"
  if [[ "${sm_enabled}" != "true" && "${sp_enabled}" != "true" ]]; then
    state_set_bool "sovereign_mesh.relay.enabled" "false"
    return 0
  fi

  if ! wt_yesno "Embedded Nostr relay (ADR-009)" \
    "Run an embedded Nostr relay for external-agent messaging?\n\nThe relay gives external agents and humans a signed,\naudited path to message agents running inside the\ncontainer. Every accepted event is persisted to\npods/<npub>/events/inbox/<id>.json; every outbound\nmessage goes through outbox/.\n\nDefault: loopback :7777, allowlist ingress, pod-bridge on.\nImpl: nostr-rs-relay (Apache-2.0, SQLite-backed, in nixpkgs)."; then
    state_set_bool "sovereign_mesh.relay.enabled" "false"
    validate_candidate
    return 0
  fi

  state_set_bool "sovereign_mesh.relay.enabled" "true"

  # Implementation
  local impl
  impl="$(wt_menu "Relay — Implementation" \
    "Which relay to embed?" \
    12 72 4 \
    "nostr-rs-relay" "default: SQLite, mature, in nixpkgs" \
    "rnostr"         "LMDB + NIP-50 full-text search" \
    "external"       "host-provided (federation.mode=client)" \
    "off"            "disabled (you can still flip it later)")"
  [[ -z "${impl}" ]] && impl="nostr-rs-relay"
  state_set "sovereign_mesh.relay.implementation" "${impl}"

  # Binding + expose
  local expose_choice
  expose_choice="$(wt_menu "Relay — Network binding" \
    "Who can reach the relay?" \
    11 72 3 \
    "loopback"      "127.0.0.1 only — local mesh bridge reads" \
    "host-expose"   "0.0.0.0 + publish port on compose (external agents can connect)" \
    "docker-net"    "0.0.0.0 inside container, no host publish (other containers only)")"
  case "${expose_choice}" in
    host-expose)
      state_set "sovereign_mesh.relay.bind" "0.0.0.0"
      state_set_bool "sovereign_mesh.relay.expose" "true"
      ;;
    docker-net)
      state_set "sovereign_mesh.relay.bind" "0.0.0.0"
      state_set_bool "sovereign_mesh.relay.expose" "false"
      ;;
    *)
      state_set "sovereign_mesh.relay.bind" "127.0.0.1"
      state_set_bool "sovereign_mesh.relay.expose" "false"
      ;;
  esac

  # Ingress policy
  local policy
  policy="$(wt_menu "Relay — Ingress policy" \
    "How strict is write admission?" \
    12 72 3 \
    "allowlist"    "NIP-42 AUTH + pubkey allowlist (safest)" \
    "signed-only"  "NIP-42 AUTH only; any valid signer" \
    "open"         "no AUTH required (homelab; raises W030)")"
  [[ -n "${policy}" ]] && state_set "sovereign_mesh.relay.ingress_policy" "${policy}"

  # Fanout
  local fanout
  fanout="$(wt_menu "Relay — External fanout" \
    "Bridge to NOSTR_RELAYS as well?" \
    12 72 4 \
    "off"            "embedded relay only (air-gapped mesh)" \
    "publish-only"   "push local events out, ignore external traffic" \
    "subscribe-only" "read external traffic, do not publish" \
    "bidirectional"  "both directions (maximum reach)")"
  [[ -n "${fanout}" ]] && state_set "sovereign_mesh.relay.external_fanout" "${fanout}"

  # Retention
  local retention
  retention="$(wt_inputbox "Relay — Retention" \
    "How many days to keep unexpired events?" \
    9 60 "$(state_get 'sovereign_mesh.relay.retention_days')")"
  [[ -n "${retention}" ]] && state_set "sovereign_mesh.relay.retention_days" "${retention}"

  # Wizard-side security exception wiring: when relay.enabled=true we need
  # the nostr-relay writable volume present to satisfy W021.
  # The user keeps manual control — validate_candidate will surface W021 if
  # they leave [security.exceptions.nostr-relay] unset.
  validate_candidate
}

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 10 — sovereign_mesh
# ════════════════════════════════════════════════════════════════════════════════
section_sovereign_mesh() {
  on_off() { [[ "$(state_get "$1")" == "true" ]] && echo "ON" || echo "OFF"; }

  local raw
  raw="$(wt_checklist "Sovereign Mesh" \
    "Nostr identity, NIP-98 auth, inter-agent messaging daemons" \
    20 78 6 \
    "sovereign_mesh.enabled"              "Sovereign mesh core"            "$(on_off sovereign_mesh.enabled)" \
    "sovereign_mesh.solid_pod"            "Solid-style pod service"        "$(on_off sovereign_mesh.solid_pod)" \
    "sovereign_mesh.nostr_bridge"         "Nostr bridge scaffold"          "$(on_off sovereign_mesh.nostr_bridge)" \
    "sovereign_mesh.https_bridge"         "HTTPS bridge"                   "$(on_off sovereign_mesh.https_bridge)" \
    "sovereign_mesh.publish_agent_events" "Publish agent events to Nostr"  "$(on_off sovereign_mesh.publish_agent_events)" \
    "sovereign_mesh.telegram_mirror"      "Telegram mirror (CTM)"          "$(on_off sovereign_mesh.telegram_mirror)")"

  for k in sovereign_mesh.enabled sovereign_mesh.solid_pod sovereign_mesh.nostr_bridge \
            sovereign_mesh.https_bridge sovereign_mesh.publish_agent_events \
            sovereign_mesh.telegram_mirror; do
    echo "${raw}" | grep -qw "${k}" && state_set_bool "${k}" "true" || state_set_bool "${k}" "false"
  done
  validate_candidate
}

# ════════════════════════════════════════════════════════════════════════════════
# WIZARD MAIN LOOP — run each section; retry on validation failure
# ════════════════════════════════════════════════════════════════════════════════
SECTIONS=(
  section_federation
  section_adapters
  section_gpu
  section_privacy_filter
  section_desktop
  section_toolchains
  section_skills
  section_providers
  section_consultants
  section_operator_identity
  section_observability
  section_integrations
  section_sovereign_mesh
  section_nostr_relay
)

for section_fn in "${SECTIONS[@]}"; do
  while true; do
    "${section_fn}" && break
    # validate_candidate already showed the error msgbox; loop to retry section
  done
done

# ════════════════════════════════════════════════════════════════════════════════
# SUMMARY — read-only view before committing
# ════════════════════════════════════════════════════════════════════════════════
python3 "${TUI_WRITE}" "${STATE_JSON}" "${CANDIDATE_TOML}"
_patch_operator_toml "${CANDIDATE_TOML}"
SUMMARY="$(cat "${CANDIDATE_TOML}")"
wt_msgbox "Configuration Summary (read-only)" "${SUMMARY}"

if ! wt_yesno "Confirm Save" "Save configuration to agentbox.toml?\nThe existing file will be replaced."; then
  echo "Aborted. No changes written."
  exit 0
fi

# Final validation + atomic write
python3 "${TUI_WRITE}" "${STATE_JSON}" "${CANDIDATE_TOML}"
_patch_operator_toml "${CANDIDATE_TOML}"
if ! node "${VALIDATOR}" "${CANDIDATE_TOML}" 2>&1; then
  echo "Final validation failed. No changes written."
  exit 1
fi
cp "${CANDIDATE_TOML}" "${CONFIG_FILE}"
echo "agentbox.toml updated."

# ════════════════════════════════════════════════════════════════════════════════
# ACTION MENU — what to do now
# ════════════════════════════════════════════════════════════════════════════════

ensure_docker_ready() {
  command_exists docker || ensure_command_with_install docker "Docker" "docker docker-compose-plugin" || return 1
  docker compose version >/dev/null 2>&1 || { echo "Docker Compose plugin not available."; return 1; }
  if ! systemctl is-active --quiet docker 2>/dev/null; then
    wt_yesno "Docker" "Docker daemon not active. Start it now?" && sudo systemctl start docker
  fi
  docker ps >/dev/null 2>&1
}

action="$(wt_menu "Next Action" "Choose what to do with the updated configuration" \
  14 72 4 \
  "save"       "Exit — saved, nothing more" \
  "build"      "Build runtime image (nix build .#runtime + docker load)" \
  "build-load" "Build + load, then start stack" \
  "start"      "Start stack now (agentbox.sh up / docker compose up)")"

case "${action}" in
  build|build-load)
    ensure_command_with_install nix "Nix with flakes" "nix" || { echo "Nix required for image build."; exit 1; }
    nix build .#runtime
    # nix2container output is an OCI manifest JSON (not a tarball); load via
    # the flake's copyToDockerDaemon helper which uses skopeo internally.
    nix run .#runtime.copyToDockerDaemon
    echo "Image loaded."
    if [[ "${action}" == "build-load" ]]; then
      ensure_docker_ready && docker compose up -d && docker compose ps
    fi
    ;;
  start)
    ensure_docker_ready || { echo "Docker not ready. Fix and rerun."; exit 1; }
    if [[ -x "${ROOT_DIR}/agentbox.sh" ]]; then
      "${ROOT_DIR}/agentbox.sh" up
    else
      docker compose up -d && docker compose ps
    fi
    ;;
  *)
    echo "Configuration saved. Run './agentbox.sh up' when ready to start."
    ;;
esac
