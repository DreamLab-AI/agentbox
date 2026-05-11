# Agentbox fish shell configuration
# Sourced at startup via /etc/fish/config.fish

# ── Prompt: Starship ──────────────────────────────────────────
if type -q starship
    starship init fish | source
end

# ── Smart cd: Zoxide ─────────────────────────────────────────
if type -q zoxide
    zoxide init fish | source
end

# ── History: Atuin ───────────────────────────────────────────
if type -q atuin
    atuin init fish --disable-up-arrow | source
end

# ── Direnv ───────────────────────────────────────────────────
if type -q direnv
    direnv hook fish | source
end

# ── FZF ──────────────────────────────────────────────────────
if type -q fzf
    set -gx FZF_DEFAULT_OPTS "--height 40% --layout=reverse --border --info=inline"
    if type -q fd
        set -gx FZF_DEFAULT_COMMAND "fd --type f --hidden --follow --exclude .git"
        set -gx FZF_CTRL_T_COMMAND "$FZF_DEFAULT_COMMAND"
    end
end

# ── Modern CLI aliases ───────────────────────────────────────
type -q eza    && alias ls="eza --icons --group-directories-first"
type -q eza    && alias ll="eza -la --icons --group-directories-first --git"
type -q eza    && alias la="eza -a --icons --group-directories-first"
type -q eza    && alias lt="eza --tree --level=2 --icons"
type -q bat    && alias cat="bat --style=plain"
type -q delta  && alias diff="delta"
type -q dust   && alias du="dust"
type -q procs  && alias ps="procs"
type -q bottom && alias top="btm"

# ── Git aliases ──────────────────────────────────────────────
alias gs="git status"
alias gl="git log --oneline -20"
alias gd="git diff"
alias gds="git diff --staged"
alias ga="git add"
alias gc="git commit"
alias gp="git push"
alias gpl="git pull"
alias gb="git branch"
alias gco="git checkout"
alias gsw="git switch"
alias gst="git stash"

# ── Agentbox service aliases ─────────────────────────────────
alias svc="supervisorctl status"
alias health="curl -sf http://localhost:9090/health | python3 -m json.tool"
alias ready="curl -sf http://localhost:9090/ready"
alias metrics="curl -sf http://localhost:9091/metrics | head -20"

# ── Dev helpers ──────────────────────────────────────────────
type -q just      && alias j="just"
type -q hyperfine && alias hf="hyperfine"
type -q watchexec && alias we="watchexec"
type -q tokei     && alias tk="tokei"
type -q nushell   && alias nu="nushell"

# ── Git delta as pager ───────────────────────────────────────
if type -q delta
    set -gx GIT_PAGER delta
end

# ── Container indicator ──────────────────────────────────────
set -gx AGENTBOX_CONTAINER 1

# ── AI CLI tool config homes (read-only overlay workaround) ──
set -gx CODEX_HOME /home/devuser/.codex
set -gx GIT_CONFIG_GLOBAL /home/devuser/.config/git/config

# Claude Code quick aliases
alias dsp="claude --dangerously-skip-permissions"
