#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${ROOT_DIR}/agentbox.toml"
ENV_EXAMPLE="${ROOT_DIR}/.env.example"
ENV_FILE="${ROOT_DIR}/.env"
TMP_DIR="$(mktemp -d)"
STATE_JSON="${TMP_DIR}/agentbox-state.json"
CHOICES_FILE="${TMP_DIR}/agentbox-choices.txt"
ENV_UPDATES_FILE="${TMP_DIR}/env-updates.txt"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

cd "${ROOT_DIR}"

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

prompt_yes_no() {
  local prompt="$1"
  local default="${2:-N}"
  local answer
  read -r -p "${prompt} [${default}]: " answer
  answer="${answer:-${default}}"
  [[ "${answer,,}" =~ ^(y|yes)$ ]]
}

detect_pkg_manager() {
  if command_exists pacman; then
    echo pacman
  elif command_exists apt-get; then
    echo apt
  elif command_exists dnf; then
    echo dnf
  elif command_exists zypper; then
    echo zypper
  else
    echo ""
  fi
}

install_packages() {
  local manager="$1"
  shift
  case "${manager}" in
    pacman)
      sudo pacman -Sy --needed --noconfirm "$@"
      ;;
    apt)
      sudo apt-get update
      sudo apt-get install -y "$@"
      ;;
    dnf)
      sudo dnf install -y "$@"
      ;;
    zypper)
      sudo zypper --non-interactive install "$@"
      ;;
    *)
      return 1
      ;;
  esac
}

ensure_command_with_install() {
  local cmd="$1"
  local package_hint="$2"
  local install_names="$3"
  if command_exists "${cmd}"; then
    return 0
  fi

  echo "Missing required command: ${cmd}"
  if ! prompt_yes_no "Install ${package_hint}?"; then
    return 1
  fi

  local manager
  manager="$(detect_pkg_manager)"
  if [ -z "${manager}" ]; then
    echo "No supported package manager found. Install ${package_hint} manually."
    return 1
  fi

  # shellcheck disable=SC2206
  local packages=( ${install_names} )
  install_packages "${manager}" "${packages[@]}"
  command_exists "${cmd}"
}

ensure_env_file() {
  if [ ! -f "${ENV_FILE}" ]; then
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
    echo "Created ${ENV_FILE} from .env.example"
  fi
}

get_env_value() {
  local key="$1"
  if [ -f "${ENV_FILE}" ]; then
    local line
    line="$(grep -E "^${key}=" "${ENV_FILE}" | tail -1 || true)"
    echo "${line#*=}"
  fi
}

set_env_value() {
  local key="$1"
  local value="$2"
  if grep -q -E "^${key}=" "${ENV_FILE}"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "${ENV_FILE}"
  else
    printf "%s=%s\n" "${key}" "${value}" >> "${ENV_FILE}"
  fi
}

prompt_env_value() {
  local key="$1"
  local label="$2"
  local current
  current="$(get_env_value "${key}")"

  if command_exists whiptail; then
    whiptail \
      --title "Agentbox Environment" \
      --inputbox "${label}" \
      10 78 "${current}" \
      3>&1 1>&2 2>&3
  elif command_exists dialog; then
    dialog \
      --stdout \
      --title "Agentbox Environment" \
      --inputbox "${label}" \
      10 78 "${current}"
  else
    read -r -p "${label} [${current}]: " current_input
    echo "${current_input:-${current}}"
  fi
}

maybe_prompt_env() {
  local key="$1"
  local label="$2"
  if prompt_yes_no "Edit ${key}?"; then
    local value
    value="$(prompt_env_value "${key}" "${label}")"
    set_env_value "${key}" "${value}"
  fi
}

ensure_docker_ready() {
  if ! command_exists docker; then
    ensure_command_with_install docker "Docker" "docker docker-compose-plugin" || return 1
  fi

  if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose plugin is not available."
    return 1
  fi

  if ! systemctl is-active --quiet docker; then
    echo "Docker daemon is not active."
    if prompt_yes_no "Start Docker daemon now?"; then
      sudo systemctl start docker
    fi
  fi

  docker ps >/dev/null 2>&1
}

python3 <<'PY' "${CONFIG_FILE}" "${STATE_JSON}"
import json
import pathlib
import sys
import tomllib

config_path = pathlib.Path(sys.argv[1])
state_path = pathlib.Path(sys.argv[2])

with config_path.open("rb") as fh:
    cfg = tomllib.load(fh)

state = {
    "desktop_resolution": cfg.get("desktop", {}).get("resolution", "1920x1080"),
    "features": {
        "sovereign_mesh.enabled": cfg.get("sovereign_mesh", {}).get("enabled", True),
        "sovereign_mesh.solid_pod": cfg.get("sovereign_mesh", {}).get("solid_pod", True),
        "sovereign_mesh.nostr_bridge": cfg.get("sovereign_mesh", {}).get("nostr_bridge", True),
        "desktop.enabled": cfg.get("desktop", {}).get("enabled", False),
        "skills.browser.agent_browser": cfg.get("skills", {}).get("browser", {}).get("agent_browser", True),
        "skills.browser.playwright": cfg.get("skills", {}).get("browser", {}).get("playwright", True),
        "skills.browser.qe_browser": cfg.get("skills", {}).get("browser", {}).get("qe_browser", False),
        "skills.media.ffmpeg": cfg.get("skills", {}).get("media", {}).get("ffmpeg", True),
        "skills.media.imagemagick": cfg.get("skills", {}).get("media", {}).get("imagemagick", True),
        "skills.media.comfyui_integration": cfg.get("skills", {}).get("media", {}).get("comfyui_integration", False),
        "skills.spatial_and_3d.qgis": cfg.get("skills", {}).get("spatial_and_3d", {}).get("qgis", False),
        "skills.spatial_and_3d.blender": cfg.get("skills", {}).get("spatial_and_3d", {}).get("blender", False),
        "skills.data_science.pytorch": cfg.get("skills", {}).get("data_science", {}).get("pytorch", False),
        "skills.data_science.jupyter": cfg.get("skills", {}).get("data_science", {}).get("jupyter", False),
        "skills.docs.latex": cfg.get("skills", {}).get("docs", {}).get("latex", True),
        "skills.docs.report_builder": cfg.get("skills", {}).get("docs", {}).get("report_builder", True),
        "skills.docs.mermaid": cfg.get("skills", {}).get("docs", {}).get("mermaid", True),
        "toolchains.claude": cfg.get("toolchains", {}).get("claude", True),
        "toolchains.ruflo": cfg.get("toolchains", {}).get("ruflo", True),
        "toolchains.claude_flow": cfg.get("toolchains", {}).get("claude_flow", True),
        "toolchains.agentic_qe": cfg.get("toolchains", {}).get("agentic_qe", True),
        "toolchains.nagual_qe": cfg.get("toolchains", {}).get("nagual_qe", True),
        "toolchains.codebase_memory": cfg.get("toolchains", {}).get("codebase_memory", True),
        "toolchains.rust": cfg.get("toolchains", {}).get("rust", True),
    }
}

state_path.write_text(json.dumps(state), encoding="utf-8")
PY

if ! command_exists whiptail && ! command_exists dialog; then
  ensure_command_with_install whiptail "whiptail/newt" "libnewt whiptail newt dialog" || true
fi

mapfile -t WHIPTAIL_ARGS < <(
  python3 <<'PY' "${STATE_JSON}"
import json
import sys

state = json.load(open(sys.argv[1], "r", encoding="utf-8"))

labels = {
    "sovereign_mesh.enabled": "Sovereign mesh core",
    "sovereign_mesh.solid_pod": "Solid-style pod service",
    "sovereign_mesh.nostr_bridge": "Nostr bridge scaffold",
    "desktop.enabled": "Desktop / VNC stack",
    "skills.browser.agent_browser": "Agent Browser",
    "skills.browser.playwright": "Playwright",
    "skills.browser.qe_browser": "QE browser",
    "skills.media.ffmpeg": "FFmpeg",
    "skills.media.imagemagick": "ImageMagick",
    "skills.media.comfyui_integration": "ComfyUI integration",
    "skills.spatial_and_3d.qgis": "QGIS",
    "skills.spatial_and_3d.blender": "Blender",
    "skills.data_science.pytorch": "PyTorch",
    "skills.data_science.jupyter": "Jupyter",
    "skills.docs.latex": "LaTeX toolchain",
    "skills.docs.report_builder": "Report builder",
    "skills.docs.mermaid": "Mermaid CLI",
    "toolchains.claude": "Claude",
    "toolchains.ruflo": "Ruflo",
    "toolchains.claude_flow": "Claude Flow",
    "toolchains.agentic_qe": "Agentic QE",
    "toolchains.nagual_qe": "Nagual QE",
    "toolchains.codebase_memory": "Codebase Memory MCP",
    "toolchains.rust": "Rust toolchain",
}

for key, enabled in state["features"].items():
    print(key)
    print(labels[key])
    print("ON" if enabled else "OFF")
PY
)

run_whiptail() {
  whiptail \
    --title "Agentbox Feature Selector" \
    --checklist "Select Docker/runtime features to enable in agentbox.toml" \
    28 100 20 \
    "${WHIPTAIL_ARGS[@]}" \
    3>&1 1>&2 2>&3
}

run_fallback_prompt() {
  python3 <<'PY' "${STATE_JSON}" "${CHOICES_FILE}"
import json
import sys

state = json.load(open(sys.argv[1], "r", encoding="utf-8"))
out_path = sys.argv[2]

labels = {
    "sovereign_mesh.enabled": "Sovereign mesh core",
    "sovereign_mesh.solid_pod": "Solid-style pod service",
    "sovereign_mesh.nostr_bridge": "Nostr bridge scaffold",
    "desktop.enabled": "Desktop / VNC stack",
    "skills.browser.agent_browser": "Agent Browser",
    "skills.browser.playwright": "Playwright",
    "skills.browser.qe_browser": "QE browser",
    "skills.media.ffmpeg": "FFmpeg",
    "skills.media.imagemagick": "ImageMagick",
    "skills.media.comfyui_integration": "ComfyUI integration",
    "skills.spatial_and_3d.qgis": "QGIS",
    "skills.spatial_and_3d.blender": "Blender",
    "skills.data_science.pytorch": "PyTorch",
    "skills.data_science.jupyter": "Jupyter",
    "skills.docs.latex": "LaTeX toolchain",
    "skills.docs.report_builder": "Report builder",
    "skills.docs.mermaid": "Mermaid CLI",
    "toolchains.claude": "Claude",
    "toolchains.ruflo": "Ruflo",
    "toolchains.claude_flow": "Claude Flow",
    "toolchains.agentic_qe": "Agentic QE",
    "toolchains.nagual_qe": "Nagual QE",
    "toolchains.codebase_memory": "Codebase Memory MCP",
    "toolchains.rust": "Rust toolchain",
}

selected = []
print("whiptail/dialog not found. Using text mode.\n")
for key, enabled in state["features"].items():
    default = "Y" if enabled else "n"
    answer = input(f"{labels[key]} [{default}] ").strip().lower()
    use_enabled = enabled if answer == "" else answer in {"y", "yes", "1", "true"}
    if use_enabled:
        selected.append(key)

with open(out_path, "w", encoding="utf-8") as fh:
    for item in selected:
        fh.write(item + "\n")
PY
}

if command_exists whiptail; then
  CHECKED="$(run_whiptail || true)"
  printf "%s\n" "${CHECKED}" | tr -d '"' | tr ' ' '\n' | sed '/^$/d' > "${CHOICES_FILE}"
elif command_exists dialog; then
  dialog --stdout \
    --title "Agentbox Feature Selector" \
    --checklist "Select Docker/runtime features to enable in agentbox.toml" \
    28 100 20 \
    "${WHIPTAIL_ARGS[@]}" > "${CHOICES_FILE}" || true
  sed -i 's/"//g' "${CHOICES_FILE}"
else
  run_fallback_prompt
fi

if [ ! -s "${CHOICES_FILE}" ]; then
  echo "No features selected; aborting without changes."
  exit 1
fi

DEFAULT_RESOLUTION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["desktop_resolution"])' "${STATE_JSON}")"
read -r -p "Desktop resolution [${DEFAULT_RESOLUTION}]: " DESKTOP_RESOLUTION
DESKTOP_RESOLUTION="${DESKTOP_RESOLUTION:-${DEFAULT_RESOLUTION}}"

python3 <<'PY' "${CHOICES_FILE}" "${DESKTOP_RESOLUTION}" "${CONFIG_FILE}"
import pathlib
import sys

choices_path = pathlib.Path(sys.argv[1])
resolution = sys.argv[2]
config_path = pathlib.Path(sys.argv[3])
selected = set(line.strip() for line in choices_path.read_text(encoding="utf-8").splitlines() if line.strip())

def enabled(key: str) -> str:
    return "true" if key in selected else "false"

content = f"""[core]
orchestration = "ruflo-v3"
vector_db = "ruvector-embedded"

[sovereign_mesh]
enabled = {enabled("sovereign_mesh.enabled")}
solid_pod = {enabled("sovereign_mesh.solid_pod")}
nostr_bridge = {enabled("sovereign_mesh.nostr_bridge")}

[desktop]
enabled = {enabled("desktop.enabled")}
resolution = "{resolution}"

[skills.browser]
agent_browser = {enabled("skills.browser.agent_browser")}
playwright = {enabled("skills.browser.playwright")}
qe_browser = {enabled("skills.browser.qe_browser")}

[skills.media]
ffmpeg = {enabled("skills.media.ffmpeg")}
imagemagick = {enabled("skills.media.imagemagick")}
comfyui_integration = {enabled("skills.media.comfyui_integration")}

[skills.spatial_and_3d]
qgis = {enabled("skills.spatial_and_3d.qgis")}
blender = {enabled("skills.spatial_and_3d.blender")}

[skills.data_science]
pytorch = {enabled("skills.data_science.pytorch")}
jupyter = {enabled("skills.data_science.jupyter")}

[skills.docs]
latex = {enabled("skills.docs.latex")}
report_builder = {enabled("skills.docs.report_builder")}
mermaid = {enabled("skills.docs.mermaid")}

[toolchains]
claude = {enabled("toolchains.claude")}
ruflo = {enabled("toolchains.ruflo")}
claude_flow = {enabled("toolchains.claude_flow")}
agentic_qe = {enabled("toolchains.agentic_qe")}
nagual_qe = {enabled("toolchains.nagual_qe")}
codebase_memory = {enabled("toolchains.codebase_memory")}
rust = {enabled("toolchains.rust")}
"""

config_path.write_text(content, encoding="utf-8")
PY

ensure_env_file

echo ""
echo "Optional .env updates"
maybe_prompt_env "ANTHROPIC_API_KEY" "Anthropic API key"
maybe_prompt_env "OPENAI_API_KEY" "OpenAI API key or 'ollama'"
maybe_prompt_env "GOOGLE_GEMINI_API_KEY" "Google Gemini API key"
maybe_prompt_env "PERPLEXITY_API_KEY" "Perplexity API key"
maybe_prompt_env "MANAGEMENT_API_KEY" "Management API key"
maybe_prompt_env "AGENTBOX_AGENT_ID" "Agent identity name"
maybe_prompt_env "NOSTR_RELAYS" "Comma-separated Nostr relays"

echo ""
echo "Updated ${CONFIG_FILE}"
echo ""
cat "${CONFIG_FILE}"
echo ""

if prompt_yes_no "Build the image before starting Docker?"; then
  ensure_command_with_install nix "Nix with flakes" "nix" || {
    echo "Nix is required for image build."
    exit 1
  }
  nix build .#runtime
  docker load < result
fi

if prompt_yes_no "Start Docker stack now with 'docker compose up -d'?"; then
  ensure_docker_ready || {
    echo "Docker is not ready. Fix Docker and rerun the launcher."
    exit 1
  }
  docker compose up -d
  docker compose ps
fi
