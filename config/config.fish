# Agentbox fish shell configuration
# Sourced at startup via /etc/fish/config.fish

# ── Prompt: Starship ──────────────────────────────────────────
if type -q starship
    set -gx STARSHIP_CONFIG /opt/agentbox/config/starship.toml
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

# ── Claude Code config dir: share the primary login everywhere ──
# Default every interactive shell (ad-hoc panes, SSH, sub-project dirs, tabs
# 2-7) to the primary config dir so the Anthropic credential persists instead
# of prompting a per-directory login under `dsp` (claude --permission-mode auto).
# Guarded with `set -q`: tmux-autostart's profile tabs (Z.AI/OpenRouter/etc.)
# and any explicit override still run AFTER this and win, so profile isolation
# holds. NOT baked into image env on purpose — that leaked into the profile
# wrappers' subprocesses; fish-only scope keeps supervisor-launched wrappers
# isolated since they never source fish.
set -q CLAUDE_CONFIG_DIR; or set -gx CLAUDE_CONFIG_DIR /home/devuser/.claude

# Claude Code quick aliases
alias dsp="claude --permission-mode auto"       # auto mode; dspb = legacy blanket bypass
alias dspb="claude --permission-mode bypassPermissions"

# ── notes: the working vault in Rune, from any window (ADR-2029) ──
# notes              today's journal (or the vault, on a Rune without --today)
# notes yesterday    yesterday's journal
# notes <page>       the page whose file name matches, anywhere in the vault
# notes --kg [page]  the same against the governed knowledge vault
# Shares window 9's recovery store ($WORKSPACE/.rune-home), so two panes on one
# page are reconciled by Rune's conflict guard rather than overwriting.
function notes --description 'Open the vault in Rune: notes [--kg] [yesterday|<page>]'
    set -l root $AGENTBOX_NOTES_ROOT
    test -n "$root"; or set root $VAULT_WORKING_ROOT
    test -n "$root"; or set root $VAULT_ROOT
    if test (count $argv) -gt 0; and test "$argv[1]" = --kg
        set root $VAULT_ROOT
        set -e argv[1]
    end
    if test -z "$root"; or not test -d "$root"
        echo "notes: no vault ([vault].working / [vault].root unset or missing)" >&2
        return 1
    end
    set -l ws $WORKSPACE
    test -n "$ws"; or set ws /home/devuser/workspace
    set -l home $ws/.rune-home
    mkdir -p $home; or return 1
    set -l daily_dir journals
    set -q NOTES_DAILY_DIR; and set daily_dir $NOTES_DAILY_DIR
    set -l template templates/Journal.md
    set -q NOTES_DAILY_TEMPLATE; and set template $NOTES_DAILY_TEMPLATE

    if test (count $argv) -eq 0
        if env HOME=$home rune --help 2>&1 | string match -q -- '*--today*'; and test -d $root/$daily_dir
            set -l extra --today --daily-dir $daily_dir
            test -f $root/$template; and set extra $extra --daily-template $template
            env HOME=$home rune -w $root $extra
        else
            env HOME=$home rune -w $root
        end
        return
    end

    if test "$argv[1]" = yesterday
        set -l file $root/$daily_dir/(date -d yesterday +%Y-%m-%d).md
        if not test -f $file
            echo "notes: no journal for yesterday ($file)" >&2
            return 1
        end
        env HOME=$home rune -w $root $file
        return
    end

    # A page by name: exact file name first, then a case-insensitive match.
    set -l name (string join ' ' -- $argv)
    set -l hit (find $root -type f -name "$name.md" -not -path '*/.*' 2>/dev/null | head -n 1)
    test -n "$hit"; or set hit (fd --type f --ignore-case --glob "*$name*.md" $root 2>/dev/null | head -n 1)
    if test -z "$hit"
        echo "notes: no page matching '$name' under $root" >&2
        return 1
    end
    env HOME=$home rune -w $root $hit
end

# ── User customizations from the persistent workspace volume ──
# The rootfs is read-only and ~/.config is tmpfs, so ad-hoc shell tweaks
# (aliases, ssh shortcuts) die on restart unless they live on the workspace
# volume. Source a well-known file from there if present.
if test -f /home/devuser/workspace/.config.fish
    source /home/devuser/workspace/.config.fish
end
