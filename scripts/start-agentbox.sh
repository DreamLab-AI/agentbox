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
    "${WT}" --title "${title}" --menu "${prompt}" "${h}" "${w}" "${lh}" "$@" 3>&1 1>&2 2>&3 || true
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
    "${WT}" --title "${title}" --checklist "${prompt}" "${h}" "${w}" "${lh}" "$@" 3>&1 1>&2 2>&3 | tr -d '"' || true
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
    "${WT}" --title "${title}" --inputbox "${prompt}" "${h}" "${w}" "${init}" 3>&1 1>&2 2>&3 || echo "${init}"
  else
    read -r -p "${prompt} [${init}]: " val >&2
    echo "${val:-${init}}"
  fi
}

wt_passwordbox() {
  local title="$1" prompt="$2" h="$3" w="$4"
  if [[ -n "${WT}" ]]; then
    "${WT}" --title "${title}" --passwordbox "${prompt}" "${h}" "${w}" "" 3>&1 1>&2 2>&3 || true
  else
    read -r -s -p "${prompt}: " val >&2; echo >&2
    echo "${val}"
  fi
}

wt_yesno() {
  local title="$1" prompt="$2"
  if [[ -n "${WT}" ]]; then
    "${WT}" --title "${title}" --yesno "${prompt}" 8 78 3>&1 1>&2 2>&3
  else
    read -r -p "${prompt} [y/N]: " ans >&2
    [[ "${ans,,}" =~ ^(y|yes)$ ]]
  fi
}

wt_msgbox() {
  local title="$1" msg="$2"
  if [[ -n "${WT}" ]]; then
    "${WT}" --title "${title}" --msgbox "${msg}" 20 78 3>&1 1>&2 2>&3 || true
  else
    echo -e "${msg}" >&2
  fi
}

# ── validation helper ──────────────────────────────────────────────────────────
# Writes candidate TOML from current state, runs validator.
# Returns 0 if valid; shows error msgbox and returns 1 if not.
validate_candidate() {
  python3 "${TUI_WRITE}" "${STATE_JSON}" "${CANDIDATE_TOML}"
  local errs
  errs="$(node "${VALIDATOR}" "${CANDIDATE_TOML}" 2>&1 >/dev/null || true)"
  if [[ -n "${errs}" ]]; then
    wt_msgbox "Validation Errors" \
      "Current selections produced errors. Correct them before proceeding.\n\n${errs}"
    return 1
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
docker network ls 2>/dev/null | grep -q docker_ragflow && DETECTED_RAGFLOW=true

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
    [pods]="local-jss external off"
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
    22 78 11 \
    "toolchains.claude"          "Claude CLI"             "$(on_off toolchains.claude)" \
    "toolchains.claude_code"     "Claude Code"            "$(on_off toolchains.claude_code)" \
    "toolchains.ruflo"           "Ruflo orchestrator"     "$(on_off toolchains.ruflo)" \
    "toolchains.claude_flow"     "Claude Flow v3"         "$(on_off toolchains.claude_flow)" \
    "toolchains.agentic_qe"      "Agentic QE"             "$(on_off toolchains.agentic_qe)" \
    "toolchains.nagual_qe"       "Nagual QE"              "$(on_off toolchains.nagual_qe)" \
    "toolchains.gemini_cli"      "Gemini CLI"             "$(on_off toolchains.gemini_cli)" \
    "toolchains.code_server"     "code-server (VS Code)"  "$(on_off toolchains.code_server)" \
    "toolchains.codebase_memory" "Codebase Memory MCP"    "$(on_off toolchains.codebase_memory)" \
    "toolchains.rust"            "Rust toolchain"         "$(on_off toolchains.rust)" \
    "toolchains.cuda"            "CUDA toolchain"         "$(on_off toolchains.cuda)")"

  for key in toolchains.claude toolchains.claude_code toolchains.ruflo toolchains.claude_flow \
             toolchains.agentic_qe toolchains.nagual_qe toolchains.gemini_cli toolchains.code_server \
             toolchains.codebase_memory toolchains.rust toolchains.cuda; do
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

  for pname in anthropic openai gemini deepseek perplexity openrouter context7 brave github zai; do
    if echo "${raw_prov}" | grep -qw "${pname}"; then
      state_set_bool "providers.${pname}.enabled" "true"
      local env_var="${PROV_ENV[${pname}]}"
      local current_val; current_val="$(get_env_value "${env_var}")"
      local hint="${env_var}"
      [[ -n "${current_val}" ]] && hint="${env_var} (currently set — leave blank to keep)"
      local secret
      secret="$(wt_passwordbox "Provider: ${pname}" "Enter ${hint}" 9 78)"
      if [[ -n "${secret}" ]]; then
        set_env_value "${env_var}" "${secret}"
      elif [[ -z "${current_val}" ]]; then
        wt_msgbox "Provider warning" \
          "No value entered for ${env_var}.\nProvider '${pname}' will fail E017 at boot unless added to .env manually."
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
  # RagFlow — only offered when docker_ragflow network is detected
  if [[ "${DETECTED_RAGFLOW}" == "true" ]]; then
    if wt_yesno "Integrations — RagFlow" \
      "docker_ragflow network detected. Enable [integrations.ragflow]?"; then
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
# SECTION 10 — sovereign_mesh
# ════════════════════════════════════════════════════════════════════════════════
section_sovereign_mesh() {
  on_off() { [[ "$(state_get "$1")" == "true" ]] && echo "ON" || echo "OFF"; }

  local raw
  raw="$(wt_checklist "Sovereign Mesh" \
    "Nostr identity, NIP-98 auth, inter-agent messaging daemons" \
    20 78 7 \
    "sovereign_mesh.enabled"              "Sovereign mesh core"            "$(on_off sovereign_mesh.enabled)" \
    "sovereign_mesh.solid_pod"            "Solid-style pod service"        "$(on_off sovereign_mesh.solid_pod)" \
    "sovereign_mesh.nostr_bridge"         "Nostr bridge scaffold"          "$(on_off sovereign_mesh.nostr_bridge)" \
    "sovereign_mesh.https_bridge"         "HTTPS bridge"                   "$(on_off sovereign_mesh.https_bridge)" \
    "sovereign_mesh.publish_agent_events" "Publish agent events to Nostr"  "$(on_off sovereign_mesh.publish_agent_events)" \
    "sovereign_mesh.telegram_mirror"      "Telegram mirror (CTM)"          "$(on_off sovereign_mesh.telegram_mirror)" \
    "sovereign_mesh.jss_rust_backend"     "JSS Rust backend"               "$(on_off sovereign_mesh.jss_rust_backend)")"

  for k in sovereign_mesh.enabled sovereign_mesh.solid_pod sovereign_mesh.nostr_bridge \
            sovereign_mesh.https_bridge sovereign_mesh.publish_agent_events \
            sovereign_mesh.telegram_mirror sovereign_mesh.jss_rust_backend; do
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
  section_desktop
  section_toolchains
  section_skills
  section_providers
  section_observability
  section_integrations
  section_sovereign_mesh
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
SUMMARY="$(cat "${CANDIDATE_TOML}")"
wt_msgbox "Configuration Summary (read-only)" "${SUMMARY}"

if ! wt_yesno "Confirm Save" "Save configuration to agentbox.toml?\nThe existing file will be replaced."; then
  echo "Aborted. No changes written."
  exit 0
fi

# Final validation + atomic write
python3 "${TUI_WRITE}" "${STATE_JSON}" "${CANDIDATE_TOML}"
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
    docker load < result
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
