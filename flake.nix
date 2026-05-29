{
  description = "Agentbox — modular sovereign multi-agent container";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    nix2container.url = "github:nlewo/nix2container";
    rust-overlay.url = "github:oxalica/rust-overlay";

    # D.9: skills corpus as a content-addressed Nix input.
    # Currently a path-type input (file-system equivalent to ./skills).
    # Future: flip to fetchFromGitHub once DreamLab-AI/agentbox-skills exists:
    #   skills.url = "github:DreamLab-AI/agentbox-skills/main";
    # Then run: nix flake lock --update-input skills
    skills = {
      url = "path:./skills";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, flake-utils, nix2container, rust-overlay, skills }:
    flake-utils.lib.eachSystem [
      "x86_64-linux"
      "aarch64-linux"
      "x86_64-darwin"
      "aarch64-darwin"
    ] (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ rust-overlay.overlays.default ];
          config = {
            allowUnfree = true;
            # python3.12-ecdsa is flagged insecure upstream (timing-side-channel
            # class; CVE class, not a concrete CVE). scripts/sovereign-bootstrap.py
            # uses it only for local secp256k1 keypair generation + bech32
            # encoding, not on any remote-attacker-observable path. The signing
            # hot path (NIP-98 verify, bridge signer) uses @noble/curves via
            # nostr-tools in management-api, which is constant-time. Tracking
            # upstream for an ecdsa bump or nixpkgs overlay replacement.
            permittedInsecurePackages = [
              "python3.12-ecdsa-0.19.1"
              "python3.12-ecdsa-0.19.2"
            ];
          };
        };

        lib = pkgs.lib;
        n2c = nix2container.packages.${system}.nix2container;

        agentboxConfig = builtins.fromTOML (builtins.readFile ./agentbox.toml);
        coreCfg = agentboxConfig.core or {};
        sovereignCfg = agentboxConfig.sovereign_mesh or {};
        networkingCfg = agentboxConfig.networking or {};
        desktopCfg = agentboxConfig.desktop or {};
        isWaylandStack = (desktopCfg.stack or "i3-x11") == "hyprland-wayland";
        isXorgNvidiaStack = (desktopCfg.stack or "i3-x11") == "xorg-nvidia";
        webgpuEnabled  = desktopCfg.webgpu or false;
        skillsCfg = agentboxConfig.skills or {};
        toolchainCfg = agentboxConfig.toolchains or {};
        browserCfg = skillsCfg.browser or {};
        mediaCfg = skillsCfg.media or {};
        spatialCfg = skillsCfg.spatial_and_3d or {};
        dataScienceCfg = skillsCfg.data_science or {};
        docsCfg = skillsCfg.docs or {};
        researchCfg = skillsCfg.research or {};
        codeInterpreterCfg = skillsCfg.code_interpreter or {};
        securityCfg = agentboxConfig.security or {};
        securityExceptions = securityCfg.exceptions or {};
        consultantsCfg = agentboxConfig.consultants or {};
        privacyFilterCfg = agentboxConfig.privacy_filter or {};
        relayCfg = (sovereignCfg.relay or {});
        adaptersCfgTop = agentboxConfig.adapters or {};
        solidPodRsCfg  = (agentboxConfig.integrations or {}).solid_pod_rs or {};
        podsImpl       = adaptersCfgTop.pods or "local-solid-rs";
        solidPodRsActive = podsImpl == "local-solid-rs";

        # Provider gates. Ollama sidecar defaults OFF — most deployments
        # already run ollama on the host (docker.internal:11434), and the
        # m3 unified-GPU pass added the sidecar block ungated, which is the
        # bug this flag fixes (see commit 278dc5a4).
        providersCfg = agentboxConfig.providers or {};
        ollamaSidecarEnabled = ((providersCfg.ollama or {}).sidecar or false);

        # GPU backend dispatch — single source of truth for GPU concerns.
        gpuLib = import ./lib/gpu-backend.nix { inherit lib pkgs; };
        gpuCfg = gpuLib.dispatchGpuBackend
                   (agentboxConfig.gpu.backend or "none")
                   (toolchainCfg.cuda or false);

        # ---------------------------------------------------------------------------
        # PRD-002 §9 Phase 2 — global npm CLI derivations via lib/npm-cli.nix.
        #
        # Each entry replaces a `npm install -g` call that was previously in
        # config/entrypoint-unified.sh Phase 7. All versions are exact semver pins;
        # ^ / ~ are disallowed. sha256 values are SRI hashes of the registry .tgz.
        #
        # Packages using lib.fakeHash will throw at evaluation time with the exact
        # nix-prefetch-url command needed to obtain the real hash (see makeNpmCli).
        #
        # Version-bump procedure (applies to all entries):
        #   1. Update version = "..." below.
        #   2. Run: nix-prefetch-url https://registry.npmjs.org/<pkg>/-/<basename>-<ver>.tgz
        #      then: nix hash to-sri --type sha256 <base32>
        #   3. Replace the sha256 value.
        #   Renovate custom-managers in renovate.json automate step 1.
        # ---------------------------------------------------------------------------
        npmCliLib = import ./lib/npm-cli.nix { inherit lib pkgs; };
        mkNpmCli  = npmCliLib.makeNpmCli;

        # 1. ruvector — always enabled; replaces npx in [program:ruvector] supervisor block.
        #    nix-prefetch-url https://registry.npmjs.org/ruvector/-/ruvector-0.2.25.tgz
        ruvectorPkg = mkNpmCli {
          pkgName         = "ruvector";
          version         = "0.2.25";
          sha256          = "sha256-CPzyPQjPQNO3C8HdBt8wlmCZNJn1DVev+/HBycoDakk=";
          nodeModulesHash = "sha256-5ol92/2asyQoXLYQzZPsuQRIHB5gGjyJlw/FZiLMq1g=";
          bin             = "ruvector";
        };

        # 2. @claude-flow/cli — gated by toolchains.claude_flow.
        #    nix-prefetch-url https://registry.npmjs.org/%40claude-flow/cli/-/cli-3.6.12.tgz
        claudeFlowPkg = mkNpmCli {
          pkgName         = "@claude-flow/cli";
          version         = "3.7.0-alpha.75";
          sha256          = "sha256-YIINkMsXVcC0OE/NGdWEFu3x6iOeJUWc4C+jL5XKRcU=";
          nodeModulesHash = "sha256-s8zZY54kMGXDH94/C36y0nUsJGlPcLXuZ5Uu57n8OxM=";
          bin             = "claude-flow";
        };

        # 3. ruflo — gated by toolchains.ruflo.
        #    nix-prefetch-url https://registry.npmjs.org/ruflo/-/ruflo-3.6.12.tgz
        rufloPkg = mkNpmCli {
          pkgName         = "ruflo";
          version         = "3.7.0-alpha.75";
          sha256          = "sha256-djmHrNDuK/GkFXyUXuH1aY6PdIP8O0tGs2L7mbMIXDk=";
          nodeModulesHash = "sha256-ZYHyjdlME3JbsdAPWkXwEhxPgmjpKEuNhvU8OEieVIw=";
          bin             = "ruflo";
        };

        # 4. agentic-qe — gated by toolchains.agentic_qe.
        #    DEFERRED SIDE EFFECT: `aqe init --auto` writes user config and agent
        #    templates to $HOME/.claude/agents/ — it must run as the runtime user
        #    after container start, NOT at Nix build time. Add to agentbox.sh init:
        #      [[ "${ENABLE_AGENTIC_QE:-false}" == "true" ]] && aqe init --auto || true
        #    nix-prefetch-url https://registry.npmjs.org/agentic-qe/-/agentic-qe-3.9.18.tgz
        agenticQePkg = mkNpmCli {
          pkgName         = "agentic-qe";
          version         = "3.10.0";
          sha256          = "sha256-R1ffQ/S4pLp9OUonKi9q9OFg/YnSNChRQgoKRUPl1Xo=";
          nodeModulesHash = "sha256-VGtIFer95NQV5NlJeuz1pksyexg1+28OGhqaZ/SHmwU=";
          bin             = "aqe";
        };

        # 5. nagual-qe — gated by toolchains.nagual_qe.
        #    Built from source via lib/nagual-qe.nix (Rust crate, not on npm).
        #    See that file for version/rev pinning + Cargo feature defaults.
        #    Definition lives further down alongside solid-pod-rs (matched
        #    Rust-build pattern).

        # 6. codebase-memory-mcp — gated by toolchains.codebase_memory.
        #    nix-prefetch-url https://registry.npmjs.org/codebase-memory-mcp/-/codebase-memory-mcp-0.6.0.tgz
        codebaseMemoryPkg = mkNpmCli {
          pkgName         = "codebase-memory-mcp";
          version         = "0.6.1";
          sha256          = "sha256-31h/HsnXK/UWLm1PSM6ztkA3jj1EoN4u1duziAWGyAc=";
          nodeModulesHash = "sha256-/WISJTkAYozn9rkRgMnDON4cThlrOmjCpZ0RV+/l9ug=";
          bin             = "codebase-memory-mcp";
        };

        # 7–8. agent-browser and playwright CLI removed — all browser
        #       automation routes through the external browsercontainer sidecar
        #       (chrome-devtools-mcp at browsercontainer:8931/sse).

        # 9. @mermaid-js/mermaid-cli — gated by skills.docs.mermaid.
        #    Binary name is mmdc (upstream convention).
        #    Bumped 11.14.0 -> 11.15.0 (2026-05-11) for `wardley-beta` quality
        #    fixes: hyphenated names (PR #7642) + de-sanitisation (PR #7726).
        #    11.15.0 is what GitHub Markdown rendering ships today.
        #    Re-fetch hashes:
        #      nix-prefetch-url https://registry.npmjs.org/%40mermaid-js/mermaid-cli/-/mermaid-cli-11.15.0.tgz
        #      then `nix build` once with the lib.fakeHash placeholder for
        #      nodeModulesHash to harvest the real hash from the error.
        mermaidCliPkg = mkNpmCli {
          pkgName         = "@mermaid-js/mermaid-cli";
          version         = "11.15.0";
          sha256          = "sha256-9v0Iedv1AORTeEu9nbkq6VEJfg6eipDsYT8r08qPoGw=";
          nodeModulesHash = "sha256-VMW5gJSlTf/EpoR8Re5Pp1rg5zYmZwHgkw+RCzqYJ+o=";
          bin             = "mmdc";
        };

        # ruvector is always included; rest are feature-gated. nagual-qe is
        # NOT in this list — it is a Rust source build wired via nagualQePkg
        # alongside solid-pod-rs (see further down) and added to the package
        # set via nagualQePackages.
        npmCliAlwaysPackages = [ ruvectorPkg ];
        npmCliGatedPackages =
          lib.optionals (toolchainCfg.claude_flow or false)       [ claudeFlowPkg ]
          ++ lib.optionals (toolchainCfg.ruflo or false)           [ rufloPkg ]
          ++ lib.optionals (toolchainCfg.agentic_qe or false)      [ agenticQePkg ]
          ++ lib.optionals (toolchainCfg.codebase_memory or false)  [ codebaseMemoryPkg ]
          ++ lib.optionals (docsCfg.mermaid or false)              [ mermaidCliPkg ];

        # 3DGS stack — gated by gaussian_splatting + local-cuda (E006).
        gs3dLib = import ./lib/3dgs-stack.nix { inherit lib pkgs; };
        gauss3dPackages = lib.optionals (spatialCfg.gaussian_splatting or false)
          (gs3dLib.makeGaussianSplattingPackages { inherit system; });

        # ---------------------------------------------------------------------------
        # PRD-002 §9 Phase 1 — local npm service derivations via buildNpmPackage.
        #
        # npmDepsHash values must be computed by the operator before first build:
        #   nix run nixpkgs#prefetch-npm-deps -- <service>/package-lock.json
        #
        # Each service that still carries lib.fakeHash will throw at evaluation
        # time with the exact resolver command (see lib/npm-services.nix).
        # ---------------------------------------------------------------------------
        npmServicesLib = import ./lib/npm-services.nix { inherit lib pkgs; };

        # 1. management-api — always-on; 18 prod deps (fastify + otel + prom-client)
        managementApiPkg = npmServicesLib.makeNpmService {
          name        = "management-api";
          src         = ./management-api;
          entry       = "server.js";
          # Prefetched 2026-04-24 against management-api/package-lock.json.
          # Refresh via: nix run nixpkgs#prefetch-npm-deps -- management-api/package-lock.json
          # Prefetched 2026-04-27. Refresh: nix run nixpkgs#prefetch-npm-deps -- management-api/package-lock.json
          npmDepsHash = "sha256-KSyQJIMlbZHm2qWaw7Djpi4tJ4Zfm9st+umvHJuwrD8=";
        };

        # 2. mcp/nostr-bridge — sovereign_mesh service; 2 deps (nostr-tools, ws)
        nostrBridgePkg = npmServicesLib.makeNpmService {
          name        = "nostr-bridge";
          src         = ./mcp;
          entry       = "servers/nostr-bridge.js";
          # Prefetched 2026-04-24 after regenerating mcp/package-lock.json
          # (the shipped lockfile predated the nostr-tools dep addition).
          # Refresh: nix run nixpkgs#prefetch-npm-deps -- mcp/package-lock.json
          npmDepsHash = "sha256-/+arrMvbSbUKlX6EFdoXQv5oh5p3UDgns3eGX+UG0nM=";
        };

        # 3. skills/openai-codex/mcp-server — gated by toolchains.codex
        codexMcpPkg = npmServicesLib.makeNpmService {
          name        = "openai-codex-mcp";
          src         = ./skills/openai-codex/mcp-server;
          entry       = "server.js";
          # Prefetched 2026-04-24. Refresh: nix run nixpkgs#prefetch-npm-deps -- skills/openai-codex/mcp-server/package-lock.json
          npmDepsHash = "sha256-lDX5EgJ/41iC9NjYgJ8w5VAUP3AlgIwY5tmJE0MGgI4=";
        };

        # 4. skills/lazy-fetch/mcp-server — gated by toolchains.ruflo or claude_flow.
        # TypeScript source: buildPhaseExtra runs tsc; output is dist/mcp-server.js.
        lazyFetchMcpPkg = npmServicesLib.makeNpmService {
          name             = "lazy-fetch-mcp";
          src              = ./skills/lazy-fetch/mcp-server;
          entry            = "dist/mcp-server.js";
          # QE audit P0: `npx --yes tsc` attempts to fetch typescript from npm
          # which fails in the Nix sandbox (network disabled). Provide tsc via
          # nativeBuildInputs instead — typescript comes from nixpkgs, not npm.
          extraBuildInputs = [ pkgs.typescript ];
          buildPhaseExtra  = ''
            export HOME="$TMPDIR"
            tsc --project tsconfig.json
          '';
          # Prefetched 2026-04-24. Refresh: nix run nixpkgs#prefetch-npm-deps -- skills/lazy-fetch/mcp-server/package-lock.json
          npmDepsHash = "sha256-Bh72Bvdqmqnyqoleqmmofp2feMspGOu6+xnfCz3xIbY=";
        };

        # 5–6. playwright-mcp and vglrunChromium removed — browser automation
        #       is exclusively via the external browsercontainer sidecar.

        # 7. mcp/consultants — consultant tier (PRD-005 / ADR-011). Single
        # buildNpmPackage with five bin entries; ships when consultants.enabled
        # = true. Each individual consultant is gated separately at runtime via
        # the manifest's [consultants.<name>].enabled flag, but they share one
        # node_modules tree because the shared/ scaffolding is internal-only.
        consultantsPkg = npmServicesLib.makeNpmService {
          name        = "agentbox-consultants";
          src         = ./mcp/consultants;
          entry       = "shared/consultant-base.js";  # smoke-load target
          # Prefetched 2026-04-25. Refresh:
          #   nix run nixpkgs#prefetch-npm-deps -- mcp/consultants/package-lock.json
          # Prefetched 2026-04-25. Refresh: nix run nixpkgs#prefetch-npm-deps -- mcp/consultants/package-lock.json
          npmDepsHash = "sha256-o6Tn1wvHvXbDg3yjqXM0J8WMsTMP7suukMgl3L+fYr0=";
        };

        # 6. skills/comfyui/mcp-server — gated by skills.media.comfyui_builtin.
        # sharp has native gyp bindings; python3 + nodeGyp are required to rebuild
        # it against the Nix libc.
        comfyuiMcpPkg = npmServicesLib.makeNpmService {
          name             = "comfyui-mcp";
          src              = ./skills/comfyui/mcp-server;
          entry            = "server.js";
          skipLoadCheck    = true;
          extraBuildInputs = [ pkgs.python3 pkgs.node-gyp ];
          extraEnv         = { npm_config_build_from_source = "true"; };
          # Prefetched 2026-04-24. Refresh: nix run nixpkgs#prefetch-npm-deps -- skills/comfyui/mcp-server/package-lock.json
          npmDepsHash = "sha256-3OchWVs/H+swo4KzBcicvs0+4FW8RVNDqc4DrmC81Xc=";
        };

        # Conditional package lists for allPackages — mirrors the lib.optionals
        # pattern used for codexPackages, antigravityCliPackages, etc.
        npmServicePackages =
          # management-api is always included
          [ managementApiPkg ]
          # nostr-bridge: when sovereign_mesh.enabled (same gate as supervisord block)
          ++ lib.optionals (sovereignCfg.enabled or false) [ nostrBridgePkg ]
          # openai-codex MCP server: when toolchains.codex enabled
          ++ lib.optionals (toolchainCfg.codex or false) [ codexMcpPkg ]
          # lazy-fetch MCP: when ruflo or claude_flow enabled
          ++ lib.optionals ((toolchainCfg.ruflo or false) || (toolchainCfg.claude_flow or false)) [ lazyFetchMcpPkg ]
          # comfyui MCP: when skills.media.comfyui_builtin enabled
          ++ lib.optionals (mediaCfg.comfyui_builtin or false) [ comfyuiMcpPkg ]
          # Consultants: ship the full bundle when the master gate is on.
          # Per-consultant runtime gating lives in [consultants.<name>].enabled.
          ++ lib.optionals ((agentboxConfig.consultants or {}).enabled or false) [ consultantsPkg ];

        boolEnv = value: if value then "true" else "false";

        basePackages = with pkgs; [
          bash
          fish
          sudo
          coreutils
          cacert
          curl
          wget
          git
          git-lfs
          gh
          jq
          ripgrep
          fd
          gnugrep
          gnused
          gawk
          findutils
          which
          less
          file
          tree
          tmux
          # tmux session persistence + monitoring plugins (PRD-013 F15-F19)
          tmuxPlugins.resurrect
          tmuxPlugins.continuum
          tmuxPlugins.cpu
          tmuxPlugins.logging
          tmuxPlugins.tmux-thumbs
          vim
          nano
          unzip
          zip
          gzip
          xz
          htop
          ncdu
          ncurses         # provides clear, tput, reset, infocmp, tic — terminal handling
          procps
          openssh
          inetutils       # hostname, telnet, ftp, traceroute — minimal network diagnostics
          iproute2        # ip, ss — modern network introspection
          iputils         # ping, ping6, tracepath — basic reachability tests
          docker-client   # docker CLI for talking to host daemon via mounted /var/run/docker.sock
          gnumake
          gcc
          clang
          cmake
          pkg-config
          uv
          pandoc

          # Modern CLI replacements (DX tooling for agentic engineers)
          eza             # modern ls with git integration
          bat             # cat with syntax highlighting
          delta           # better git diff viewer
          dust         # visual disk usage (du replacement)
          procs           # ps replacement with colour + tree
          sd              # sed replacement with simpler syntax
          choose          # cut replacement, human-friendly field selection
          tokei           # fast code statistics
          bottom          # resource monitor (btop alternative)
          zoxide          # smart cd that learns directories
          starship        # cross-shell prompt (git, nix, rust, node indicators)
          atuin           # shell history with fuzzy search + sync
          fzf             # fuzzy finder — Ctrl-R, Ctrl-T, piping
          direnv          # per-directory environment variables
          nushell         # structured data shell (JSON/TOML piping)
          gum             # TUI prompts, menus, confirmations (Charm toolkit)

          # Dev essentials
          yq-go           # YAML processor (jq for YAML)
          hyperfine       # command benchmarking
          watchexec       # file watcher + command runner
          just            # modern make replacement
        ];

        nodeEnvPackages = with pkgs; [
          nodejs_20
          nodejs_20
          yarn
          pnpm
        ];

        # Google Antigravity CLI — replaces @google/gemini-cli (sunset 2026-06-18).
        # Binary: `agy`. Available in nixpkgs as `antigravity` (unfree).
        # Pro tier web-based login: `agy auth login`.
        antigravityCliPackages = lib.optionals (toolchainCfg.antigravity_cli or false) [
          pkgs.antigravity
        ];

        # OpenAI Codex Rust-native CLI — pinned upstream release asset.
        # See lib/codex-binary.nix for the per-arch sha256s and version bump
        # procedure.  Binary is statically linked (musl) so no runtime deps
        # are required beyond what the container already has.
        codexLib = import ./lib/codex-binary.nix { inherit lib pkgs; };
        codexPackages = lib.optionals
          ((toolchainCfg.codex or false) && pkgs.stdenv.isLinux)
          [ (codexLib.makeCodex system) ];

        # Anthropic Claude Code native CLI — pinned upstream release binary.
        # See lib/claude-code-binary.nix for the per-arch sha256s and version
        # bump procedure.  Binary is wrapped with makeBinaryWrapper to disable
        # the auto-updater and inject runtime PATH deps (ripgrep, bubblewrap).
        claudeCodeLib = import ./lib/claude-code-binary.nix { inherit lib pkgs; };
        claudeCodePackages = lib.optionals
          ((toolchainCfg.claude_code or false) && pkgs.stdenv.isLinux)
          [ (claudeCodeLib.makeClaudeCode system) ];

        # Runtime Python environment for bootstrap scripts and local helpers.
        # Use python.withPackages so every dep is on the interpreter's import
        # path inside the container — listing them as standalone derivations
        # in `allPackages` only puts them on $PATH and leaves
        # `import ecdsa` failing with ModuleNotFoundError at bootstrap time
        # (which crash-loops the container on first start).
        # sovereign-bootstrap.py imports ecdsa directly; provision-agent-stacks.py
        # imports yaml, requests, etc. — all must resolve via this interpreter.
        # Sudo built without PAM. The default `pkgs.sudo` links libpam and
        # tries to initialize a PAM session at every invocation, which
        # fails inside the agentbox container with "unable to initialize
        # PAM: Critical error - immediate abort" because no PAM modules
        # are installed (the rootfs is read-only and image bake doesn't
        # carry pam_unix.so + friends). NOPASSWD in /etc/sudoers.d/devuser
        # is the only auth path used; PAM is dead weight.
        sudoNoPam = pkgs.sudo.override { pam = null; };

        pythonRuntimeEnv = pkgs.python312.withPackages (ps: with ps; [
          pip
          virtualenv
          supervisor
          requests
          httpx
          aiohttp
          aiofiles
          pyyaml
          pydantic
          rich
          ecdsa
          numpy
          pandas
          matplotlib
          seaborn
          pymupdf
        ]);

        # Closed dependency env for the imagemagick-mcp service (Q14).
        # Previously the supervisor block did `pip install --target=/tmp` at
        # boot, downloading from PyPI on every container start — violates
        # PRD-002 §9 (hermetic closure). Bake the deps in.
        imagemagickMcpPythonEnv = pkgs.python312.withPackages (ps: with ps; [
          pip
          mcp
          httpx
          pydantic
        ]);

        pythonBasePackages = [
          pythonRuntimeEnv
          imagemagickMcpPythonEnv
        ];

        # Stable toolchain for general Rust development + WASM + static musl binaries
        rustToolchain = pkgs.rust-bin.stable.latest.minimal.override {
          extensions = [ "rust-src" "clippy" "rustfmt" ];
          targets = [
            "wasm32-unknown-unknown"
            "x86_64-unknown-linux-musl"
          ];
        };

        # Nightly toolchain for nvptx64 GPU kernel compilation (Tier 3 target)
        rustNightlyToolchain = pkgs.rust-bin.nightly.latest.minimal.override {
          extensions = [ "rust-src" "llvm-tools-preview" ];
          targets = [ "nvptx64-nvidia-cuda" ];
        };

        wasmPackages = with pkgs; [
          wasm-pack
          wasm-bindgen-cli
          binaryen
        ];

        dbPackages = with pkgs; [
          sqlite
        ];

        # browserPackages removed — chromium, playwright-driver, virtualgl and
        # supporting libs are no longer baked into the image. All browser
        # automation is handled by the external browsercontainer sidecar.
        browserPackages = [];

        # web-researcher-mcp (Go) — gated by skills.research.web_researcher.
        # The headless-browser scrape tier is intentionally disabled at runtime
        # (SCRAPER_DISABLE_BROWSER=true in skills/mcp.json) so this binary never
        # downloads or runs its own Chromium. JS-rendered pages must route to
        # the external browsercontainer sidecar via the `browser` skill.
        # Hashes need refresh on version bumps:
        #   nix-prefetch-github zoharbabin web-researcher-mcp --rev <tag>
        #   first build will print the correct vendorHash to substitute.
        webResearcherMcpPkg = pkgs.buildGoModule rec {
          pname   = "web-researcher-mcp";
          version = "1.2.2";  # bump together with hashes below
          src = pkgs.fetchFromGitHub {
            owner = "zoharbabin";
            repo  = "web-researcher-mcp";
            rev   = "v${version}";
            hash  = "sha256-YyjlFZb4EiBnUz6Wz1CK6EHQVcpqPRstZDrahDPdeyU=";
          };
          vendorHash = "sha256-GqYFGTVGLoQAD6BC/vvOeMSrxaOPEfuvdCbYLvc6y7k="; # refreshed 2026-05-21
          subPackages = [ "cmd/web-researcher-mcp" ];
          # Strip the auto-Chromium download path — we never use tier 4.
          ldflags = [ "-s" "-w" ];
          doCheck = false;
          meta = with lib; {
            description = "MCP server: 8 web research tools, 4-tier scrape (browser tier disabled here)";
            homepage    = "https://github.com/zoharbabin/web-researcher-mcp";
            license     = licenses.mit;
            mainProgram = "web-researcher-mcp";
          };
        };

        researchPackages =
          lib.optionals (researchCfg.web_researcher or false) [ webResearcherMcpPkg ];

        # ── Code-as-Harness packages (PRD-008 / ADR-018 / ADR-020) ───────────
        # Gated on [skills.code_interpreter].enabled and [skills.aci_shell].enabled.
        # Network is deliberately OFF inside the kernel — all packages are
        # pre-baked into the wheelhouse at Nix build time (no PyPI at runtime).
        # Hashes marked lib.fakeHash: the first `nix build` will print the
        # correct content-addressed hash to substitute.

        codeInterpreterPythonEnv = pkgs.python312.withPackages (ps: with ps; [
          numpy pandas scipy sympy matplotlib scikit-learn requests
          beautifulsoup4 lxml networkx pydantic
          ipykernel jupyter-client
          psycopg2          # for RuVector writes if needed inside kernel tasks
          prometheus-client
        ]);

        # Pre-built wheelhouse directory — copied from the Nix-constructed
        # Python environment. No PyPI fetch at runtime; pip --no-index
        # --find-links points at this directory.
        codeInterpreterWheelhousePkg = pkgs.runCommand "code-interpreter-wheelhouse-0.1.0" {
          buildInputs = [ pkgs.python312 codeInterpreterPythonEnv ];
        } ''
          mkdir -p $out/wheelhouse
          # Copy site-packages from the Nix-cured Python env as wheel stubs.
          # The MCP server's install_pkg path uses --no-index --find-links=
          # pointing here; packages are imported directly from the env, not
          # re-installed from wheels, so this dir acts as the version manifest.
          cp -r ${codeInterpreterPythonEnv}/lib/python3.12/site-packages $out/wheelhouse/site-packages || true
          # Marker file for runtime validation (entrypoint checks this).
          echo "0.1.0" > $out/wheelhouse/.agentbox-wheelhouse-version
        '';

        codeInterpreterMcpPkg = pkgs.runCommand "agentbox-code-interpreter-mcp-0.1.0" {} ''
          mkdir -p $out/bin $out/share/agentbox/mcp/code-interpreter
          cp -r ${./mcp/code-interpreter}/. $out/share/agentbox/mcp/code-interpreter/
          cat > $out/bin/code-interpreter-mcp <<'WRAPPER'
          #!/usr/bin/env bash
          exec ${codeInterpreterPythonEnv}/bin/python3 \
            $out/share/agentbox/mcp/code-interpreter/server.py "$@"
          WRAPPER
          chmod +x $out/bin/code-interpreter-mcp
        '';

        aciShellMcpPkg = pkgs.runCommand "agentbox-aci-shell-mcp-0.1.0" {} ''
          mkdir -p $out/bin $out/share/agentbox/mcp/aci-shell
          cp -r ${./mcp/aci-shell}/. $out/share/agentbox/mcp/aci-shell/
          cat > $out/bin/aci-shell-mcp <<'WRAPPER'
          #!/usr/bin/env bash
          exec ${pkgs.nodejs_22}/bin/node \
            $out/share/agentbox/mcp/aci-shell/server.js "$@"
          WRAPPER
          chmod +x $out/bin/aci-shell-mcp
        '';

        codeHarnessPackages =
          lib.optionals (codeInterpreterCfg.enabled or false) [
            codeInterpreterPythonEnv
            codeInterpreterWheelhousePkg
            codeInterpreterMcpPkg
          ]
          ++ lib.optionals ((skillsCfg.aci_shell or {}).enabled or false) [
            aciShellMcpPkg
          ];

        # ComfyUI built-in: fetch upstream source and wrap with a Python env.
        # Included only when skills.media.comfyui_builtin = true.
        # Bump the rev + hash intentionally via a PR when upgrading.
        comfyuiRev  = "v0.3.27";
        comfyuiHash = "sha256-UGM2nrxveSEPuZAFY+Os0R1z/eWzlm8viG7sobis498=";
        _comfyuiGuard =
          if mediaCfg.comfyui_builtin or false
             && comfyuiHash == "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
          then throw ''
            flake.nix: skills.media.comfyui_builtin is enabled but the ComfyUI source hash
            is still the placeholder. To build the built-in ComfyUI path:
              1. Run: nix-prefetch-url --unpack https://github.com/comfyanonymous/ComfyUI/archive/${comfyuiRev}.tar.gz
              2. Replace comfyuiHash in flake.nix with the returned sha256.
            Alternatively: set skills.media.comfyui_builtin = false and use
            [integrations.comfyui_external] to point at a running ComfyUI instance.
          ''
          else null;
        comfyuiSrc = pkgs.fetchFromGitHub {
          owner = "comfyanonymous";
          repo  = "ComfyUI";
          rev   = comfyuiRev;
          hash  = comfyuiHash;
        };

        comfyuiPythonEnv = pkgs.python312.withPackages (ps: with ps; [
          torch
          torchvision
          torchaudio
          aiohttp
          einops
          transformers
          safetensors
          pyyaml
          pillow
          scipy
          tqdm
          psutil
        ]);

        comfyuiPackages = lib.optionals (mediaCfg.comfyui_builtin or false) [
          comfyuiPythonEnv
        ];

        mediaPackages = with pkgs;
          lib.optionals (mediaCfg.ffmpeg or false) [ ffmpeg ]
          ++ lib.optionals (mediaCfg.imagemagick or false) [ imagemagick ]
          ++ comfyuiPackages;

        spatialPackages =
          lib.optionals (spatialCfg.qgis or false) [
            pkgs.qgis
            pkgs.python312Packages.pyqt5
          ]
          ++ lib.optionals (spatialCfg.blender or false) [
            pkgs.blender
          ]
          # 3DGS stack: only when gaussian_splatting=true (requires local-cuda via E006)
          ++ gauss3dPackages;

        dataSciencePackages =
          lib.optionals (dataScienceCfg.pytorch or false) [
            pkgs.python312Packages.torch
          ]
          ++ lib.optionals (dataScienceCfg.jupyter or false) [
            pkgs.python312Packages.numpy
            pkgs.python312Packages.pandas
            pkgs.python312Packages.jupyter
            pkgs.python312Packages.jupyterlab
            pkgs.python312Packages.notebook
            pkgs.python312Packages.ipykernel
          ];

        docsPackages =
          lib.optionals ((docsCfg.latex or false) || (docsCfg.report_builder or false)) [
            pkgs.texliveFull
            pkgs.biber
          ];

        networkingPackages =
          lib.optionals (networkingCfg.tailscale or false) [
            pkgs.tailscale
          ];

        # ---------------------------------------------------------------------------
        # Privacy filter (ADR-008) — local openai/privacy-filter sidecar.
        # Gate: privacy_filter.enabled = true.
        # The sidecar loads the HF model once at startup and exposes /classify,
        # /redact, /health, /metrics on privacy_filter.port (default 9092, loopback).
        # Model weights are fetched on first boot via transformers/huggingface_hub
        # and persisted under /workspace/.cache/huggingface; no network traffic
        # after warm-up. BF16 on GPU, BF16 on CPU, or Q4 on CPU (transformers.js
        # path is out-of-scope; this is the server path).
        # ---------------------------------------------------------------------------
        # ---------------------------------------------------------------------------
        # solid-pod-rs — first-class Solid Protocol 0.11 server (ADR-010).
        # Gate: adapters.pods = "local-solid-rs" (the default).
        # Source: github.com/DreamLab-AI/solid-pod-rs (AGPL-3.0-only; consistent
        # with agentbox AGPL-3.0 — see docs/developer/licensing.md). Derivation
        # module in lib/solid-pod-rs.nix uses fakeHash placeholders that surface
        # prefetch commands at realisation.
        # ---------------------------------------------------------------------------
        solidPodRsLib = import ./lib/solid-pod-rs.nix { inherit lib pkgs; };
        # Opt-in features layered on top of defaultFeatures in lib/solid-pod-rs.nix.
        # did-nostr / webhook-signing / rate-limit / quota / jss-v04 are in the
        # default set; opting out requires a source-level edit of that file.
        # Library-crate features are addressed via the solid-pod-rs/<name>
        # dep-path so cargo enables them on the workspace member when the
        # server crate doesn't forward them.
        solidPodRsExtraFeatures =
          lib.optionals (solidPodRsCfg.enable_oidc or false)       [ "solid-pod-rs/oidc" ]
          ++ lib.optionals (solidPodRsCfg.enable_dpop_cache or false) [ "solid-pod-rs/dpop-replay-cache" ]
          ++ lib.optionals ((solidPodRsCfg.storage or "fs") == "s3") [ "solid-pod-rs/s3-backend" ]
          ++ lib.optionals ((solidPodRsCfg.notifications or "websocket") == "webhook"
                            && (solidPodRsCfg.enable_webhook_signing or true)) [
               "solid-pod-rs/legacy-notifications"
             ];
        solidPodRsPkg =
          if solidPodRsActive
          then solidPodRsLib.makeSolidPodRs { extraFeatures = solidPodRsExtraFeatures; }
          else null;
        solidPodRsPackages = lib.optionals solidPodRsActive [ solidPodRsPkg ];

        # ---------------------------------------------------------------------------
        # nagual-qe — Rust QE knowledge system (proffesor-for-testing/nagual-qe).
        # Gate: toolchains.nagual_qe = true.
        # Built from source — there is no npm publication. Lives next to
        # solid-pod-rs because both are first-party Rust source builds via
        # buildRustPackage with a hash-verified Cargo vendor FOD.
        # ---------------------------------------------------------------------------
        nagualQeLib = import ./lib/nagual-qe.nix { inherit lib pkgs; };
        nagualQePkg =
          if (toolchainCfg.nagual_qe or false)
          then nagualQeLib.makeNagualQe { }
          else null;
        nagualQePackages = lib.optionals (toolchainCfg.nagual_qe or false) [ nagualQePkg ];

        # ---------------------------------------------------------------------------
        # Linked-Data context catalogue (PRD-006 / ADR-012 / DDD-004).
        # Gate: linked_data.enabled = true.
        # Materialises every pinned @context document into one read-only directory
        # at /opt/agentbox/contexts/. The runtime resolver loads the index once
        # at boot and never fetches a context document at runtime (DDD-004 §L09).
        # ---------------------------------------------------------------------------
        linkedDataCfg     = agentboxConfig.linked_data or {};
        linkedDataActive  = (linkedDataCfg.enabled or false) == true;
        linkedDataContexts = import ./lib/linked-data-contexts.nix { inherit lib pkgs; };
        linkedDataPackages = lib.optionals linkedDataActive [ linkedDataContexts ];

        # ---------------------------------------------------------------------------
        # Linked-Object Viewer (S12, PRD-006 §15).
        # Gate: linked_data.viewer.mode = "local-linkedobjects".
        # First-implementation viewer; the slot accepts other implementations
        # behind the same /lo/manifest.json contract (see PRD-006 §15.4 and
        # docs/developer/browser-panes.md).
        # ---------------------------------------------------------------------------
        viewerCfg          = linkedDataCfg.viewer or {};
        viewerMode         = viewerCfg.mode or "off";
        viewerLocalActive  = viewerMode == "local-linkedobjects";
        linkedObjectsBrowserLib = import ./lib/linkedobjects-browser.nix { inherit lib pkgs; };
        linkedObjectsBrowserPkg =
          if viewerLocalActive
          then linkedObjectsBrowserLib.makeLinkedObjectsBrowser { }
          else null;
        linkedObjectsBrowserPackages = lib.optionals viewerLocalActive [ linkedObjectsBrowserPkg ];

        # ---------------------------------------------------------------------------
        # Embedded Nostr relay (ADR-009 / PRD-004).
        # Gate: sovereign_mesh.relay.enabled = true AND implementation in the
        # Nix-packageable set {nostr-rs-relay, rnostr}. External / off variants
        # do not add a package; external still publishes the supervisor block
        # only as a bridge-side concern (no local WS process).
        # ---------------------------------------------------------------------------
        relayEnabled = relayCfg.enabled or false;
        relayImpl    = relayCfg.implementation or "nostr-rs-relay";
        relayLocal   = relayEnabled && (relayImpl == "nostr-rs-relay" || relayImpl == "rnostr");

        # Fail-fast for rnostr until a reproducible nixpkgs source lands.
        # nostr-rs-relay is in nixpkgs (v0.9.0 as of 2026-04); rnostr is not
        # yet packaged upstream, so require the operator to vendor it.
        _relayImplGuard =
          if relayEnabled && relayImpl == "rnostr"
             && !(pkgs ? rnostr)
          then throw ''
            flake.nix: sovereign_mesh.relay.implementation="rnostr" but pkgs.rnostr
            is not available in the pinned nixpkgs. Either:
              (a) set implementation = "nostr-rs-relay" in agentbox.toml, or
              (b) vendor rnostr via a flake input (see docs/developer/sovereign-mesh.md).
          ''
          else null;

        relayPkg =
          if relayEnabled && relayImpl == "nostr-rs-relay" then pkgs.nostr-rs-relay
          else if relayEnabled && relayImpl == "rnostr" then pkgs.rnostr
          else null;

        relayPackages = lib.optionals relayLocal (lib.filter (p: p != null) [ relayPkg ]);

        # Render a config.toml for nostr-rs-relay from manifest fields.
        # Consumed by the supervisor block at /etc/agentbox/nostr-relay.toml.
        relayAllowedKinds = relayCfg.allowed_kinds or [ 1 1059 30078 27235 38000 38100 ];
        relayAllowedKindsToml = lib.concatStringsSep ", " (map toString relayAllowedKinds);
        relayAllowedPubkeys = relayCfg.allowed_pubkeys or [];
        relayAllowedPubkeysToml =
          if relayAllowedPubkeys == []
          then ""
          else "pubkey_whitelist = [ " + lib.concatStringsSep ", " (map (k: "\"${k}\"") relayAllowedPubkeys) + " ]\n";
        relayNip42Auth =
          if (relayCfg.ingress_policy or "allowlist") == "open" then "false" else "true";
        relayConfigText = ''
# AUTO-GENERATED from agentbox.toml — do not edit by hand.
[info]
name        = "agentbox-relay"
description = "${relayCfg.info_description or "Agentbox sovereign relay"}"
${lib.optionalString ((relayCfg.info_contact or "") != "") "contact     = \"${relayCfg.info_contact}\""}
relay_url   = "ws://${relayCfg.bind or "127.0.0.1"}:${toString (relayCfg.port or 7777)}/"

[network]
address        = "${relayCfg.bind or "127.0.0.1"}"
port           = ${toString (relayCfg.port or 7777)}
remote_ip_header = "x-forwarded-for"
ping_interval  = 300

[database]
engine         = "sqlite"
data_directory = "${relayCfg.data_dir or "/var/lib/nostr-relay"}"
in_memory      = false
min_conn       = 0
max_conn       = 16

[limits]
messages_per_sec      = ${toString (relayCfg.messages_per_sec or 5)}
subscriptions_per_min = 60
max_event_bytes       = ${toString (relayCfg.max_event_bytes or 131072)}
max_ws_message_bytes  = ${toString (relayCfg.max_event_bytes or 131072)}
max_ws_frame_bytes    = ${toString (relayCfg.max_event_bytes or 131072)}
max_blocking_threads  = 16
broadcast_buffer      = 16384
event_persist_buffer  = 4096

[authorization]
${relayAllowedPubkeysToml}nip42_auth = ${relayNip42Auth}
nip42_dms  = ${if relayCfg.allow_nip04 or false then "true" else "false"}

[options]
reject_future_seconds = 1800

[retention]
# NIP-40 expiration is honoured in-code; this is the default fallback
# applied to events that do not declare an expiration tag.
default_days = ${toString (relayCfg.retention_days or 30)}
'';

        privacyFilterEnabled = privacyFilterCfg.enabled or false;
        privacyFilterPythonEnv = pkgs.python312.withPackages (ps: with ps; [
          transformers
          safetensors
          tokenizers
          torch
          huggingface-hub
          aiohttp
          pyyaml
        ]);
        privacyFilterPackages = lib.optionals privacyFilterEnabled [ privacyFilterPythonEnv ];

        desktopPackages = lib.optionals (desktopCfg.enabled or false) (
          # Shared X11/Wayland tools present in both stacks
          (with pkgs; [
            xkbcomp xkeyboard_config setxkbmap  # keyboard config shared by XWayland
            xauth xset xdpyinfo xprop xwininfo   # X11 utils (also work over XWayland)
            xterm xfce4-terminal                  # terminals
            dejavu_fonts liberation_ttf noto-fonts-cjk-sans fontconfig
            xdotool xclip scrot feh pcmanfm
          ]) ++
          # Stack-specific compositor + VNC server
          (if isWaylandStack then with pkgs; [
            hyprland     # Wayland compositor (implements declared stack = "hyprland-wayland")
            xwayland     # X11 compat on DISPLAY=:1 for agent-browser and legacy tools
            wayvnc       # VNC server that captures the Wayland compositor output
            wlr-randr    # Display management for wlroots-based compositors
          ] else if isXorgNvidiaStack then with pkgs; [
            xorg-server      # real Xorg with NVIDIA driver — native GLX/EGL
            xf86-input-libinput
            xrandr
            x11vnc       # scrapes Xorg framebuffer → VNC port 5901
            i3 i3status dmenu
          ] else with pkgs; [
            tigervnc     # Xvnc: X server + VNC in one binary (correct XKB paths)
            i3           # tiling WM — stable in Nix containers (openbox segfaults)
            i3status dmenu
          ])
        );

        allPackages =
          basePackages
          ++ nodeEnvPackages
          ++ pythonBasePackages
          ++ [ rustToolchain rustNightlyToolchain pkgs.pkgsStatic.stdenv.cc pkgs.musl ]
          ++ wasmPackages
          ++ dbPackages
          ++ browserPackages
          ++ researchPackages
          ++ codeHarnessPackages
          ++ mediaPackages
          ++ spatialPackages
          ++ dataSciencePackages
          ++ docsPackages
          ++ privacyFilterPackages
          ++ relayPackages
          ++ solidPodRsPackages
          ++ nagualQePackages
          ++ desktopPackages
          ++ antigravityCliPackages
          ++ codexPackages
          ++ claudeCodePackages
          ++ networkingPackages
          ++ gpuCfg.nixPackages
          # PRD-002 §9 Phase 1 — pre-packaged local npm services (immutable bootstrap)
          ++ npmServicePackages
          # PRD-002 §9 Phase 2 — global npm CLI derivations (replaces npm install -g)
          ++ npmCliAlwaysPackages
          ++ npmCliGatedPackages;

        # D.9: skillsTree is sourced from inputs.skills (path-type input).
        # Switching to a remote upstream is a one-line inputs change + flake.lock regen.
        skillsTree = skills;

        appRoot = pkgs.runCommand "agentbox-app-root" {} ''
          mkdir -p $out/opt/agentbox

          # PRD-002 Phase 1: npm services are copied from their Nix derivation
          # outputs (which already contain baked-in node_modules) rather than
          # from the raw source tree.  The derivation $out/package symlink
          # points at the full package directory including node_modules.
          cp -rL ${managementApiPkg}/package $out/opt/agentbox/management-api

          # mcp source tree is always copied (contains servers/, scripts/, config/).
          # When sovereign_mesh is enabled, nostrBridgePkg overlays the mcp
          # directory so its node_modules are present at runtime.
          cp -r ${./mcp} $out/opt/agentbox/mcp

          cp -r ${skillsTree} $out/opt/agentbox/skills
          cp -r ${./scripts} $out/opt/agentbox/scripts
          cp -r ${./config} $out/opt/agentbox/config
          cp -r ${./https-bridge} $out/opt/agentbox/https-bridge
          cp -r ${./docs} $out/opt/agentbox/docs
          cp -r ${./aisp} $out/opt/agentbox/aisp
          cp ${./agentbox.toml} $out/opt/agentbox/agentbox.toml

          # Linked-Data context catalogue (PRD-006 / ADR-012). Always copied
          # so [linked_data].enabled = true at runtime works without rebuild;
          # when the master gate is off, the resolver never reads this dir.
          mkdir -p $out/opt/agentbox/contexts
          cp -rL ${linkedDataContexts}/. $out/opt/agentbox/contexts/

          ${lib.optionalString viewerLocalActive ''
          # Linked-Object Viewer bundle (S12, PRD-006 §15). Mounted by
          # management-api at the operator-configured /lo prefix.
          mkdir -p $out/opt/agentbox/browser
          cp -rL ${linkedObjectsBrowserPkg}/. $out/opt/agentbox/browser/
          ''}

          # tmux plugin loader — generated with Nix-interpolated store paths so
          # run-shell lines resolve correctly without TPM or runtime path search.
          # Sourced from tmux.conf via: source-file /opt/agentbox/config/tmux-plugins.conf
          chmod -R u+w $out/opt/agentbox/config
          cp ${pkgs.writeText "tmux-plugins.conf" ''
            run-shell ${pkgs.tmuxPlugins.resurrect}/share/tmux-plugins/resurrect/resurrect.tmux
            run-shell ${pkgs.tmuxPlugins.continuum}/share/tmux-plugins/continuum/continuum.tmux
            run-shell ${pkgs.tmuxPlugins.cpu}/share/tmux-plugins/cpu/cpu.tmux
            run-shell ${pkgs.tmuxPlugins.logging}/share/tmux-plugins/logging/logging.tmux
            run-shell ${pkgs.tmuxPlugins.tmux-thumbs}/share/tmux-plugins/tmux-thumbs/tmux-thumbs.tmux
          ''} $out/opt/agentbox/config/tmux-plugins.conf

          # `cp -r` from the Nix store preserves the read-only store bits on
          # every copied file, which blocks the subsequent node_modules and
          # mcp-server overlays below with "Permission denied". Make the
          # whole copied tree writable once before any overlay runs.
          chmod -R u+w $out/opt/agentbox

          ${lib.optionalString (sovereignCfg.enabled or false) ''
          cp -rL ${nostrBridgePkg}/package/node_modules $out/opt/agentbox/mcp/node_modules
          ''}

          # Optional skills — copy derivation package trees (includes node_modules)
          # when the corresponding feature gate is enabled.
          # rm -rf the source-tree copy first: skillsTree cp above places source
          # files at mcp-server/ already, so cp -rL into an existing dir would
          # nest the package one level too deep ($dir/package/ instead of $dir/).
          ${lib.optionalString (toolchainCfg.codex or false) ''
          rm -rf $out/opt/agentbox/skills/openai-codex/mcp-server
          mkdir -p $out/opt/agentbox/skills/openai-codex
          cp -rL ${codexMcpPkg}/package $out/opt/agentbox/skills/openai-codex/mcp-server
          ''}
          ${lib.optionalString ((toolchainCfg.ruflo or false) || (toolchainCfg.claude_flow or false)) ''
          rm -rf $out/opt/agentbox/skills/lazy-fetch/mcp-server
          mkdir -p $out/opt/agentbox/skills/lazy-fetch
          cp -rL ${lazyFetchMcpPkg}/package $out/opt/agentbox/skills/lazy-fetch/mcp-server
          ''}
          # playwright-mcp skills copy removed — no local browser in image
          ${lib.optionalString (mediaCfg.comfyui_builtin or false) ''
          rm -rf $out/opt/agentbox/skills/comfyui/mcp-server
          mkdir -p $out/opt/agentbox/skills/comfyui
          cp -rL ${comfyuiMcpPkg}/package $out/opt/agentbox/skills/comfyui/mcp-server
          ''}
          ${lib.optionalString ((agentboxConfig.consultants or {}).enabled or false) ''
          mkdir -p $out/opt/agentbox/mcp
          cp -rL ${consultantsPkg}/package $out/opt/agentbox/mcp/consultants
          ''}

          chmod +x $out/opt/agentbox/config/entrypoint-unified.sh
          find $out/opt/agentbox/scripts -type f -name '*.sh' -exec chmod +x {} +
          find $out/opt/agentbox/scripts -type f -name '*.py' -exec chmod +x {} +
          find $out/opt/agentbox/mcp -maxdepth 2 -type f -name '*.js' -exec chmod +x {} +

          # Bake FHS shims into the image so wrapper scripts (`#!/usr/bin/env sh`,
          # `#!/bin/sh`, etc.) and the Claude Code binary's `/lib64/ld-linux`
          # work without a writable /usr/bin (or /bin or /lib64) tmpfs.
          # nix2container's read_only rootfs makes the runtime mkdir+ln-sf
          # in entrypoint.sh silently fail, leaving every npm-style wrapper
          # ENOENT at exec time.
          mkdir -p $out/usr/bin $out/bin $out/lib64
          ln -s ${pkgs.coreutils}/bin/env $out/usr/bin/env
          ln -sf ${pkgs.bash}/bin/sh $out/bin/sh
          ln -sf ${pkgs.bash}/bin/bash $out/bin/bash
          ln -sf ${pkgs.fish}/bin/fish $out/bin/fish
          ln -sf ${pkgs.glibc}/lib/ld-linux-x86-64.so.2 $out/lib64/ld-linux-x86-64.so.2
        '';

        qgisServiceBlock = ''
[program:qgis-mcp]
command=${pkgs.python312}/bin/python3 -u /opt/agentbox/scripts/qgis_mcp_standalone.py
directory=/opt/agentbox/scripts
user=devuser
environment=HOME="/home/devuser"
autostart=true
autorestart=true
priority=230
stdout_logfile=/var/log/qgis-mcp.log
stderr_logfile=/var/log/qgis-mcp.error.log
        '';

        blenderServiceBlock = ''
[program:blender-mcp]
command=${pkgs.nodejs_20}/bin/node /opt/agentbox/skills/blender/tools/blender-mcp-proxy.js
directory=/opt/agentbox/skills/blender/tools
user=devuser
environment=HOME="/home/devuser"
autostart=true
autorestart=true
priority=231
stdout_logfile=/var/log/blender-mcp.log
stderr_logfile=/var/log/blender-mcp.error.log
        '';

        jupyterServiceBlock = ''
[program:jupyter-lab]
command=${pkgs.python312Packages.jupyterlab}/bin/jupyter-lab --ip=0.0.0.0 --port=8888 --no-browser --ServerApp.token=
directory=/home/devuser/workspace
user=devuser
environment=HOME="/home/devuser"
autostart=true
autorestart=true
priority=232
stdout_logfile=/var/log/jupyter-lab.log
stderr_logfile=/var/log/jupyter-lab.error.log
        '';

        # Desktop supervisor blocks — stack-conditional on agentbox.toml [desktop].stack.
        #
        # "hyprland-wayland": Hyprland compositor → XWayland (:1) → wayvnc (:5901).
        #   WLR_BACKENDS defaults to "headless" for container safety; override to
        #   "drm" at runtime when NVIDIA DRM is mapped in (needs /dev/dri/card0).
        #   Chrome uses ANGLE-Vulkan for WebGPU regardless of compositor backend.
        #
        # "xorg-nvidia": Real Xorg server with NVIDIA proprietary driver.
        #   AllowEmptyInitialConfiguration + ConnectedMonitor DFP-0 creates a
        #   virtual display. Xorg provides native GLX/EGL — Chrome gets a real
        #   GPU context without VirtualGL. x11vnc scrapes the Xorg framebuffer
        #   and exports over VNC port 5901. Requires /dev/dri/card* + NVIDIA
        #   userspace libs mapped into the container.
        #
        # "i3-x11" (default): TigerVNC Xvnc on :1 + i3 WM. Xvnc is a software
        #   framebuffer with NO GLX/EGL support. Chrome cannot create a GPU
        #   context (WebGL or WebGPU) on Xvnc directly. VirtualGL is required:
        #   it intercepts GL/Vulkan calls, renders on the real GPU via DRM render
        #   nodes (/dev/dri/renderD128+), and composites the result back to Xvnc.
        #   The playwright-mcp supervisor wraps chromium with vglrun when WebGPU
        #   is enabled.
        desktopBlocks =
          if isWaylandStack then ''
[program:hyprland]
command=${pkgs.hyprland}/bin/Hyprland --config /opt/agentbox/config/hyprland.conf
user=devuser
; WLR_BACKENDS=headless is the container-safe default (no DRM device needed).
; Override to drm in docker-compose environment for GPU-backed compositor when
; NVIDIA_DRIVER_CAPABILITIES=graphics and /dev/dri/card0 is mapped in.
environment=HOME="/home/devuser",WAYLAND_DISPLAY="wayland-1",XDG_RUNTIME_DIR="/run/user/1000",XDG_SESSION_TYPE="wayland",WLR_NO_HARDWARE_CURSORS="1",WLR_BACKENDS="%(ENV_WLR_BACKENDS)s",WLR_HEADLESS_OUTPUTS="1",DISPLAY=":1",HYPRLAND_TRACE="0"
autostart=true
autorestart=true
startsecs=2
priority=40
stdout_logfile=/var/log/hyprland.log
stderr_logfile=/var/log/hyprland.error.log

[program:xwayland-session]
command=${pkgs.xwayland}/bin/Xwayland :1 -rootless -noreset -wm 1
user=devuser
environment=HOME="/home/devuser",WAYLAND_DISPLAY="wayland-1",XDG_RUNTIME_DIR="/run/user/1000"
autostart=true
autorestart=true
startsecs=5
priority=41
stdout_logfile=/var/log/xwayland.log
stderr_logfile=/var/log/xwayland.error.log

[program:wayvnc]
command=${pkgs.wayvnc}/bin/wayvnc --output=HEADLESS-1 0.0.0.0 5901
user=devuser
environment=HOME="/home/devuser",WAYLAND_DISPLAY="wayland-1",XDG_RUNTIME_DIR="/run/user/1000",WLR_NO_HARDWARE_CURSORS="1"
autostart=true
autorestart=true
startsecs=5
priority=42
stdout_logfile=/var/log/wayvnc.log
stderr_logfile=/var/log/wayvnc.error.log
          '' else if isXorgNvidiaStack then ''
[program:xorg-nvidia]
command=/opt/agentbox/config/start-xorg-nvidia.sh
environment=HOME="/home/devuser"
autostart=true
autorestart=true
startsecs=3
priority=40
stdout_logfile=/var/log/xorg-nvidia.log
stderr_logfile=/var/log/xorg-nvidia.error.log

[program:i3wm]
command=${pkgs.i3}/bin/i3
user=devuser
environment=DISPLAY=":1",HOME="/home/devuser"
autostart=true
autorestart=true
startsecs=3
priority=41
stdout_logfile=/var/log/i3wm.log
stderr_logfile=/var/log/i3wm.error.log

[program:x11vnc]
command=${pkgs.x11vnc}/bin/x11vnc -display :1 -rfbport 5901 -shared -forever -nopw -noxdamage -xkb -noshm
user=devuser
environment=DISPLAY=":1",HOME="/home/devuser"
autostart=true
autorestart=true
startsecs=5
priority=42
stdout_logfile=/var/log/x11vnc.log
stderr_logfile=/var/log/x11vnc.error.log
          '' else ''
[program:xvnc]
command=${pkgs.tigervnc}/bin/Xvnc :1 -geometry ${(desktopCfg.resolution or "1920x1080")} -depth 24 -SecurityTypes None -ac -pn -rfbport 5901 -rawkeyboard
user=devuser
environment=HOME="/home/devuser"
autostart=true
autorestart=true
priority=40
stdout_logfile=/var/log/xvnc.log
stderr_logfile=/var/log/xvnc.error.log

[program:i3wm]
command=${pkgs.i3}/bin/i3
user=devuser
environment=DISPLAY=":1",HOME="/home/devuser"
autostart=true
autorestart=true
startsecs=3
priority=41
stdout_logfile=/var/log/i3wm.log
stderr_logfile=/var/log/i3wm.error.log
          '';

        supervisorText = ''
[supervisord]
nodaemon=true
logfile=/var/log/supervisord.log
pidfile=/var/run/supervisord.pid
childlogdir=/var/log/supervisor

[unix_http_server]
file=/var/run/supervisor.sock
chmod=0766

[supervisorctl]
serverurl=unix:///var/run/supervisor.sock

[rpcinterface:supervisor]
supervisor.rpcinterface_factory = supervisor.rpcinterface:make_main_rpcinterface

[program:bootstrap]
command=/opt/agentbox/config/entrypoint-unified.sh
environment=AGENTBOX_BOOTSTRAP_STAGE="B",HOME="/home/devuser",TRANSFORMERS_CACHE="/home/devuser/.cache/huggingface",HF_HOME="/home/devuser/.cache/huggingface"
autostart=true
autorestart=false
startsecs=0
priority=5
stdout_logfile=/var/log/bootstrap.log
stderr_logfile=/var/log/bootstrap.error.log

# ruvector is a CLI/library tool, not a daemon — available on PATH as 'ruvector'
# The management-api uses it via embedded-ruvector adapter (sql.js in-process)
# or external-pg adapter (PostgreSQL connection). No supervisord service needed.

[program:management-api]
command=${managementApiPkg}/bin/management-api
directory=/opt/agentbox/management-api
user=devuser
environment=HOME="/home/devuser",MANAGEMENT_API_PORT="%(ENV_MANAGEMENT_API_PORT)s",MANAGEMENT_API_KEY="%(ENV_MANAGEMENT_API_KEY)s",MANAGEMENT_API_AUTH_MODE="%(ENV_MANAGEMENT_API_AUTH_MODE)s",MEMORY_ADMIN_ACCESS_MODE="%(ENV_MEMORY_ADMIN_ACCESS_MODE)s",AGENTBOX_REQUIRED_FOR_READINESS="true"
autostart=true
autorestart=true
priority=20
stdout_logfile=/var/log/management-api.log
stderr_logfile=/var/log/management-api.error.log

; Bootstrap seal — writes /run/agentbox/bootstrap.done once every program
; tagged AGENTBOX_REQUIRED_FOR_READINESS="true" has reached RUNNING. This is
; the signal that /ready consults. priority=99 ensures it runs last;
; autorestart=false makes it a one-shot. If it times out the sentinel is never
; written and /ready remains 503 (PRD-002 §9, DDD-001 BootstrapCompletion).
[program:bootstrap-seal]
command=/opt/agentbox/config/seal-bootstrap.sh
user=devuser
autostart=true
autorestart=false
startsecs=0
priority=99
environment=SUPERVISORD_CONF="/etc/supervisord.conf",BOOTSTRAP_SEAL_TIMEOUT="120",HOME="/home/devuser"
stdout_logfile=/var/log/bootstrap-seal.log
stderr_logfile=/var/log/bootstrap-seal.error.log
${lib.optionalString ((sovereignCfg.enabled or false) && solidPodRsActive) ''

[program:solid-pod]
command=${solidPodRsPkg}/bin/solid-pod-rs-server
directory=${solidPodRsCfg.storage_root or "/var/lib/solid"}
user=devuser
environment=HOME="/home/devuser",JSS_HOST="${solidPodRsCfg.bind or "127.0.0.1"}",JSS_PORT="${toString (solidPodRsCfg.port or 8484)}",JSS_BASE_URL="${solidPodRsCfg.base_url or "http://127.0.0.1:8484"}",JSS_STORAGE_ROOT="${solidPodRsCfg.storage_root or "/var/lib/solid"}",JSS_LOG_LEVEL="${solidPodRsCfg.log_level or "info"}",RUST_LOG="${solidPodRsCfg.log_level or "info"}",JSS_ENABLE_DID_NOSTR="${boolEnv (solidPodRsCfg.enable_did_nostr or true)}",JSS_ENABLE_RATE_LIMIT="${boolEnv (solidPodRsCfg.enable_rate_limit or true)}",JSS_RATE_LIMIT_PER_SEC="${toString (solidPodRsCfg.rate_limit_per_sec or 20)}",JSS_ENABLE_QUOTA="${boolEnv (solidPodRsCfg.enable_quota or true)}",JSS_QUOTA_DEFAULT_BYTES="${toString (solidPodRsCfg.quota_default_bytes or 10737418240)}",JSS_ENABLE_WEBHOOK_SIGNING="${boolEnv (solidPodRsCfg.enable_webhook_signing or true)}",JSS_V04_COMPAT="${boolEnv (solidPodRsCfg.jss_v04_compat or true)}",SOLID_ALLOWED_ORIGINS="${solidPodRsCfg.allowed_origins or ""}",SOLID_ADMIN_KEY="%(ENV_SOLID_ADMIN_KEY)s",AGENTBOX_REQUIRED_FOR_READINESS="true"
autostart=true
autorestart=true
priority=30
stdout_logfile=/var/log/solid-pod.log
stderr_logfile=/var/log/solid-pod.error.log
''}
# nostr-bridge is a library consumed in-process by management-api (see
# mcp/nostr-bridge/relay-consumer.js header comment). No supervisord block.
# The [sovereign_mesh].nostr_bridge gate tells management-api to call
# NostrBridge.connect() at boot, not to start a separate process.
${lib.optionalString ((sovereignCfg.enabled or false) && (sovereignCfg.https_bridge or false)) ''

[program:https-bridge]
command=${pkgs.nodejs_20}/bin/node /opt/agentbox/https-bridge/https-proxy.js
directory=/opt/agentbox/https-bridge
user=devuser
environment=HOME="/home/devuser",MANAGEMENT_API_PORT="%(ENV_MANAGEMENT_API_PORT)s",CERT_DIR="/var/lib/https-bridge/certs",SSL_KEY="/var/lib/https-bridge/certs/server.key",SSL_CERT="/var/lib/https-bridge/certs/server.crt"
autostart=true
autorestart=true
priority=32
stdout_logfile=/var/log/https-bridge.log
stderr_logfile=/var/log/https-bridge.error.log
''}
# playwright-mcp supervisord block removed — browser automation via external sidecar
${lib.optionalString (mediaCfg.imagemagick or false) ''

[program:imagemagick-mcp]
command=${imagemagickMcpPythonEnv}/bin/python3 -u /opt/agentbox/skills/imagemagick/mcp-server/server.py
directory=/opt/agentbox/skills/imagemagick/mcp-server
user=devuser
environment=HOME="/home/devuser"
autostart=true
autorestart=true
priority=210
stdout_logfile=/var/log/imagemagick-mcp.log
stderr_logfile=/var/log/imagemagick-mcp.error.log
''}
${lib.optionalString (spatialCfg.qgis or false) "\n${qgisServiceBlock}"}
${lib.optionalString (spatialCfg.blender or false) "\n${blenderServiceBlock}"}
${lib.optionalString (dataScienceCfg.jupyter or false) "\n${jupyterServiceBlock}"}
${lib.optionalString (desktopCfg.enabled or false) "\n${desktopBlocks}"}
${lib.optionalString relayLocal ''

[program:nostr-relay]
command=${relayPkg}/bin/nostr-rs-relay --config /etc/agentbox/nostr-relay.toml
directory=${relayCfg.data_dir or "/var/lib/nostr-relay"}
user=devuser
environment=HOME="/home/devuser",RUST_LOG="info",AGENTBOX_REQUIRED_FOR_READINESS="false"
autostart=true
autorestart=true
priority=35
stdout_logfile=/var/log/nostr-relay.log
stderr_logfile=/var/log/nostr-relay.error.log
''}
${lib.optionalString privacyFilterEnabled ''

[program:opf-router]
command=${privacyFilterPythonEnv}/bin/python3 -u /opt/agentbox/scripts/opf-router.py
directory=/opt/agentbox/scripts
user=devuser
environment=HOME="/home/devuser",HF_HOME="/home/devuser/.cache/huggingface",TRANSFORMERS_CACHE="/home/devuser/.cache/huggingface",OPF_PORT="${toString (privacyFilterCfg.port or 9092)}",OPF_MODE="${privacyFilterCfg.mode or "off"}",OPF_DTYPE="${privacyFilterCfg.dtype or "bf16"}",OPF_MODEL="${privacyFilterCfg.model or "openai/privacy-filter"}"
autostart=true
autorestart=true
priority=240
stdout_logfile=/var/log/opf-router.log
stderr_logfile=/var/log/opf-router.error.log
''}
${lib.optionalString (networkingCfg.tailscale or false) ''

[program:tailscaled]
command=${pkgs.tailscale}/bin/tailscaled --state=/var/lib/tailscale/tailscaled.state --tun=userspace-networking --socket=/var/run/tailscale/tailscaled.sock
directory=/var/lib/tailscale
environment=HOME="/home/devuser"
autostart=true
autorestart=true
priority=15
stdout_logfile=/var/log/tailscaled.log
stderr_logfile=/var/log/tailscaled.error.log

[program:tailscale-up]
command=${pkgs.bash}/bin/bash -c "sleep 2 && if [ -n \"$TAILSCALE_AUTHKEY\" ]; then ${pkgs.tailscale}/bin/tailscale up --authkey=$TAILSCALE_AUTHKEY --hostname=${networkingCfg.hostname or "agentbox"} --accept-routes --ssh 2>&1; else echo 'No TAILSCALE_AUTHKEY set — run: docker exec agentbox tailscale up'; fi"
directory=/var/lib/tailscale
environment=HOME="/home/devuser"
autostart=true
autorestart=false
startsecs=0
priority=16
stdout_logfile=/var/log/tailscale-up.log
stderr_logfile=/var/log/tailscale-up.error.log
''}
${lib.optionalString (toolchainCfg.code_server or false) ''

[program:code-server]
command=${pkgs.code-server}/bin/code-server --bind-addr 0.0.0.0:8080 --auth none --user-data-dir /home/devuser/.local/share/code-server --extensions-dir /home/devuser/.local/share/code-server/extensions --config /home/devuser/.local/share/code-server/config.yaml /home/devuser/workspace
directory=/home/devuser/workspace
user=devuser
; XDG_CONFIG_HOME redirected into the writable codeserver-config volume
; (mounted at /home/devuser/.local/share/code-server). The default
; $HOME/.config/code-server is on the read-only rootfs.
environment=HOME="/home/devuser",XDG_CONFIG_HOME="/home/devuser/.local/share/code-server/config",XDG_DATA_HOME="/home/devuser/.local/share"
autostart=true
autorestart=true
priority=50
startsecs=5
stdout_logfile=/var/log/code-server.log
stderr_logfile=/var/log/code-server.error.log
''}
${lib.optionalString (mediaCfg.comfyui_builtin or false) ''

[program:comfyui-builtin]
command=${comfyuiPythonEnv}/bin/python3 ${comfyuiSrc}/main.py --listen 127.0.0.1 --port 8188
directory=${comfyuiSrc}
user=devuser
environment=HOME="/home/devuser",COMFYUI_OUTPUT_DIR="/home/devuser/comfyui-outputs"
autostart=true
autorestart=true
priority=220
stdout_logfile=/var/log/comfyui-builtin.log
stderr_logfile=/var/log/comfyui-builtin.error.log
''}

[program:tmux-autostart]
command=/opt/agentbox/config/tmux-autostart.sh
user=devuser
environment=HOME="/home/devuser"
autostart=true
autorestart=false
startsecs=0
priority=95
stdout_logfile=/var/log/tmux-autostart.log
stderr_logfile=/var/log/tmux-autostart.error.log
        '';

        # ---------------------------------------------------------------------------
        # composeText: manifest-driven docker-compose.yml generator.
        # Mirrors the supervisorText pattern.  lib.generators.toYAML is
        # available in nixpkgs-unstable but its YAML quoting of multiline
        # strings is non-deterministic across nixpkgs revisions, so we use
        # explicit string interpolation throughout for full determinism.
        # NOTE: gpuCfg is already bound above (GPU agent A2) as the structured
        # result of gpuLib.dispatchGpuBackend. We read the raw backend string
        # directly from the manifest here to avoid rebinding that name.
        # ---------------------------------------------------------------------------
        gpuBackendKey   = agentboxConfig.gpu.backend    or "none";
        # When [networking].host_gateway = true, default LLM base URL points
        # at the Docker host. When false (default, hardened), it points at
        # the in-Docker `ollama` service alias (Compose DNS) — only emitted
        # when the ollama sidecar is enabled (PRD-001 §providers).
        defaultLlmBaseUrl =
          if (networkingCfg.host_gateway or false)
          then "http://host.docker.internal:11434"
          else "http://ollama:11434";

        # Q26 / Q6: build a claude-flow config template at image-build time.
        # The literal `@@RUVECTOR_PG_PASSWORD@@` placeholder is expanded by
        # the entrypoint when it copies the template into $HOME/.claude-flow/
        # config.json, sourcing the live password from the env. This
        # collapses the previous three-way password disagreement (heredoc
        # in entrypoint, override env default, agentbox.toml) into one
        # source of truth (the env var).
        _pluginsMemoryCfg = (agentboxConfig.plugins or {}).memory or {};
        claudeFlowConfigJson = builtins.toJSON {
          memory = {
            backend = "external-pg";
            host = "ruvector-postgres";
            port = 5432;
            database = "ruvector";
            user = "ruvector";
            password = "@@RUVECTOR_PG_PASSWORD@@";
            enableHNSW = _pluginsMemoryCfg.enable_hnsw or true;
            embeddingDimension = _pluginsMemoryCfg.embedding_dimension or 384;
          };
        };
        integrationsCfg = agentboxConfig.integrations or {};
        ragflowCfg      = integrationsCfg.ragflow           or {};
        ruvectorExtCfg  = integrationsCfg.ruvector_external or {};
        comfyuiExtCfg   = integrationsCfg.comfyui_external  or {};
        observCfg       = agentboxConfig.observability or {};
        adaptersCfg     = agentboxConfig.adapters     or {};
        memoryCfg       = agentboxConfig.memory        or {};

        # True when the GPU backend is anything other than "none".
        gpuEnabled = gpuBackendKey != "none";

        # Derive compose-level runtime string from backend key.
        # The GPU agent (A2) owns the full translation table; we only need
        # whether we emit a runtime: line and which device mounts to add.
        gpuRuntime =
          if gpuBackendKey == "local-cuda" then "nvidia"
          else if gpuBackendKey == "local-rocm" then "rocm"
          else "none";

        # AMD ROCm device mounts (used when backend = local-rocm)
        rocmDevices = ''
      devices:
        - /dev/kfd:/dev/kfd
        - /dev/dri:/dev/dri
      group_add:
        - video
        - "988"
      security_opt:
        - seccomp=unconfined'';

        # NVIDIA runtime mount (used when backend = local-cuda)
        cudaRuntime = ''
      runtime: nvidia
      environment:
        - NVIDIA_VISIBLE_DEVICES=all
        - NVIDIA_DRIVER_CAPABILITIES=compute,utility'';

        # Ollama service block — emitted only when GPU is enabled AND the
        # operator has explicitly opted in via [providers.ollama] sidecar=true.
        # Built from explicit "\n"-joined strings (not a Nix heredoc) so the
        # leading-whitespace stripper can't eat the indent.
        ollamaServiceBlock = lib.optionalString (gpuEnabled && ollamaSidecarEnabled) (
          "  ollama:\n"
          + "    image: ollama/ollama:latest\n"
          + "    container_name: ollama\n"
          + "    restart: unless-stopped\n"
          + (if gpuRuntime == "rocm" then rocmDevices + "\n"
             else if gpuRuntime == "nvidia" then "    runtime: nvidia\n"
             else "")
          + "    ports:\n"
          + "      - \"11434:11434\"\n"
          + "    volumes:\n"
          + "      - ollama:/root/.ollama\n"
          + "    environment:\n"
          + "      - OLLAMA_HOST=0.0.0.0:11434\n"
          + lib.optionalString (gpuRuntime == "nvidia") (
              "      - NVIDIA_VISIBLE_DEVICES=all\n"
              + "      - NVIDIA_DRIVER_CAPABILITIES=compute,utility\n"
            )
          + "      - OLLAMA_VULKAN=" + (if gpuRuntime == "rocm" then "1" else "0") + "\n"
          + "      - OLLAMA_FLASH_ATTENTION=true\n"
          + "      - OLLAMA_KV_CACHE_TYPE=q8_0\n"
          + "      - OLLAMA_CONTEXT_LENGTH=8192\n"
        );

        # Ports for the agentbox service.
        # Always: management-api (9090), ruvector (9700), metrics (observCfg.metrics_port)
        # Sovereign: solid-pod (8484)
        # Desktop:  VNC (5901)
        # Jupyter:  8888
        # code_server: 8080
        metricsPort = toString (observCfg.metrics_port or 9091);

        # All ports use plain "      - " prefix; the prior single-line heredoc
        # for the first port was getting indent-stripped by Nix.
        agentboxPorts =
          "      - \"9090:9090\"\n"
          + "      - \"9700:9700\"\n"
          + "      - \"${metricsPort}:${metricsPort}\"\n"
          + lib.optionalString (sovereignCfg.enabled or false)
              "      - \"8484:8484\"\n"
          + lib.optionalString (relayEnabled && (relayCfg.expose or false))
              ("      - \"" + toString (relayCfg.port or 7777) + ":" + toString (relayCfg.port or 7777) + "\"\n")
          + lib.optionalString (dataScienceCfg.jupyter or false)
              "      - \"8888:8888\"\n"
          + lib.optionalString (desktopCfg.enabled or false)
              "      - \"5901:5901\"\n"
          + lib.optionalString ((toolchainCfg.code_server or false))
              "      - \"8080:8080\"\n";

        # agentbox depends_on block — explicit-newline string (heredoc would
        # strip the 4-space common indent and produce flush-left output).
        agentboxDependsOn = lib.optionalString (gpuEnabled && ollamaSidecarEnabled) (
          "    depends_on:\n"
          + "      ollama:\n"
          + "        condition: service_started\n"
        );

        # External network declaration — always enabled so the agentbox
        # container can reach the browsercontainer sidecar (and ragflow
        # when enabled) via Docker DNS on visionclaw_network.
        ragflowNetworkDecl = ''
  default:
  visionclaw:
    name: visionclaw_network
    external: true'';

        # agentbox network attachment block — unconditional.
        agentboxNetworks = ''
    networks:
      - default
      - visionclaw'';

        # Extra hosts. The host-gateway alias is gated by
        # [networking].host_gateway = true (Q17): air-gapped and hardened
        # deployments must opt in. When disabled, OPENAI_BASE_URL must
        # resolve via Docker DNS (sidecar service name) or fail closed.
        agentboxExtraHosts =
          lib.optionalString (networkingCfg.host_gateway or false) (
            "    extra_hosts:\n"
            + "      - \"host.docker.internal:host-gateway\"\n"
          );

        # DNS alias for ragflow when integration enabled.
        agentboxDnsAliases = lib.optionalString (ragflowCfg.enabled or false) ''
    hostname: agentbox
    dns:
      - 127.0.0.11'';

        # ---------------------------------------------------------------------------
        # Security hardening — PRD-003 §5.4 + §5.4a + ADR-007 Decision 4
        #
        # Baseline always emitted.  Feature exceptions merged on top when the
        # corresponding gate is active.  Merge semantics:
        #   tmpfs / devices / cap_add  — union (additive, dedup)
        #   security_opt               — replace-by-key (new key wins)
        #   runtime                    — override (only one runtime)
        #   writable_volumes           — appended to volumes list
        # ---------------------------------------------------------------------------

        activeExceptions =
          lib.filterAttrs
            (name: _:
              (name == "desktop"               && (desktopCfg.enabled or false))
              || (name == "gpu-rocm"           && gpuBackendKey == "ollama-rocm")
              || (name == "gpu-cuda"           && (gpuBackendKey == "ollama-cuda" || gpuBackendKey == "local-cuda"))
              || (name == "gaussian-splatting" && (spatialCfg.gaussian_splatting or false))
              || (name == "playwright"         && (browserCfg.playwright or false))
              || (name == "code-server"        && (toolchainCfg.code_server or false))
              || (name == "telegram-mirror"    && (sovereignCfg.telegram_mirror or false))
              || (name == "nostr-relay"        && relayEnabled)
              || (name == "tailscale"         && (networkingCfg.tailscale or false))
              || (name == "solid-pod-rs"      && solidPodRsActive)
              || (name == "consultants"       && (consultantsCfg.enabled or false))
            )
            securityExceptions;

        exceptionTmpfsPaths     = lib.concatMap (exc: exc.tmpfs or [])           (lib.attrValues activeExceptions);
        exceptionDevicePaths    = lib.concatMap (exc: exc.devices or [])         (lib.attrValues activeExceptions);
        exceptionCapAdd         = lib.unique (lib.concatMap (exc: exc.cap_add or [])         (lib.attrValues activeExceptions));
        exceptionWritableVolumes= lib.concatMap (exc: exc.writable_volumes or []) (lib.attrValues activeExceptions);

        # security_opt_override entries from active exceptions. ADR-007 §4a
        # documents this merge path; the playwright exception in PRD-003 §272
        # uses it to flip seccomp to "unconfined" without dropping the global
        # NNP=true baseline. Each override is applied verbatim into the
        # security_opt list at compose-emission time. See W021 below.
        exceptionSecurityOptOverrides = lib.unique (
          lib.concatMap (exc: exc.security_opt_override or []) (lib.attrValues activeExceptions)
        );

        # ADR-007 W021: when exceptions add capabilities or override security_opt
        # beyond the baseline, the operator must explicitly acknowledge the
        # widened attack surface via [security].audit_acknowledged = true.
        # Fail closed at compose-eval time when the gate is missing.
        securityCapsRaiseAttackSurface =
          (exceptionCapAdd != []) || (exceptionSecurityOptOverrides != []);
        auditAcknowledged = securityCfg.audit_acknowledged or false;
        _w021Check =
          if securityCapsRaiseAttackSurface && !auditAcknowledged
          then throw ''
            ADR-007 W021: active security exceptions widen the attack surface
            (cap_add: ${builtins.toJSON exceptionCapAdd}; security_opt_override:
            ${builtins.toJSON exceptionSecurityOptOverrides}) but
            [security].audit_acknowledged is not set to true in agentbox.toml.
            Set it to true once you have read docs/user/configuration.md and
            understand the residual risk.''
          else null;

        # Compose security_opt baseline. NNP=true unless an exception's
        # security_opt_override flips it. Merge preserves "key=value" semantics:
        # the override entry replaces any matching baseline key.
        nnpBaselineValue = "true";
        # Each override entry is rendered as an additional `      - <entry>\n`
        # under security_opt. Used by composeText.
        securityOptOverrideEmission =
          lib.optionalString (exceptionSecurityOptOverrides != [])
            ("\n" + lib.concatMapStrings (s: "      - ${s}\n") exceptionSecurityOptOverrides);

        exceptionRuntime =
          let runtimes = lib.concatMap
            (exc: if exc ? runtime then [ exc.runtime ] else [])
            (lib.attrValues activeExceptions);
          in if runtimes != [] then lib.last runtimes else null;

        # Baseline tmpfs mounts that every agentbox container needs regardless
        # of feature exceptions. /var/log is included because supervisord +
        # every [program:*] log file writes there, and read_only:true would
        # otherwise make the container unable to log. Operators who need log
        # persistence can override with a named volume at deploy time.
        # supervisord runs as PID 1 root (compose has no `user:` directive
        # baseline). Long-running [program:*] blocks drop to uid 1000 via
        # per-program `user=devuser`. /run, /var/log, /var/log/supervisor are
        # owned by root so supervisord can write its own state; bootstrap
        # creates uid-1000-owned subdirs under them as needed.
        baselineTmpfsMounts = [
          "/tmp:mode=1777,size=256M"
          # /run, /var/log, /var/log/supervisor are uid-1000-owned so
          # devuser-running services (per `user=devuser` directives) can
          # write logs and runtime state without bootstrap chown
          # acrobatics. Bootstrap-as-root still has CAP_CHOWN baseline
          # cap if it needs to fix anything.
          "/run:mode=755,size=64M,uid=1000,gid=1000"
          "/var/run:mode=755,size=16M,uid=1000,gid=1000"
          "/var/log:mode=755,size=128M,uid=1000,gid=1000"
          "/var/log/supervisor:mode=755,size=64M,uid=1000,gid=1000"
          # https-bridge cert dir — self-signed certs regenerated on
          # every boot; ephemeral by design. Writable for devuser so the
          # bridge process can re-issue if needed.
          "/var/lib/https-bridge:mode=755,size=8M,uid=1000,gid=1000"
          # devuser's XDG_CACHE_HOME. starship, npm, pip, transformers,
          # huggingface, etc. all expect a writable $HOME/.cache. Without
          # this tmpfs the path lives on the read-only rootfs and every
          # interactive shell prints "Os { code: 30, kind: ReadOnlyFilesystem }"
          # at the starship init line. 256M is plenty for prompt + tool
          # caches; persistent caches go to named volumes per-tool.
          "/home/devuser/.cache:mode=755,size=256M,uid=1000,gid=1000"
          # devuser's XDG_DATA_HOME. zoxide, fzf, atuin, npm globals,
          # pip --user, pipx, and a long tail of other XDG-aware CLIs
          # write here. Same Read-only-fs symptom as .cache without it.
          # The codeserver-config named volume mounts INSIDE this tmpfs
          # at .../code-server — Docker handles the layered mount order
          # (tmpfs first, then volumes on top), so persistence for
          # code-server is preserved.
          "/home/devuser/.local:mode=755,size=128M,uid=1000,gid=1000"
          # devuser's XDG_CONFIG_HOME. Many CLIs that don't honor
          # XDG_CONFIG_HOME still write to $HOME/.config (git, gh, kube,
          # etc.). The .config/claude and .config/claude-telegram-mirror
          # subdirs are bound from host / mounted from named volume on
          # top of this tmpfs.
          "/home/devuser/.config:mode=755,size=64M,uid=1000,gid=1000"
          # ruflo/claude-flow plugin dir. Phase 7 writes config.json (PG
          # conninfo) and symlinks plugins here. Must be writable by root
          # (entrypoint) and readable by devuser (uid 1000). Content is
          # regenerated at each boot so tmpfs is sufficient.
          "/home/devuser/.claude-flow:mode=755,size=64M,uid=1000,gid=1000"
          # OpenAI Codex CLI home. Plugin git pack + sqlite logs + session
          # history grow quickly; 512M gives plenty of headroom.
          "/home/devuser/.codex:mode=755,size=512M,uid=1000,gid=1000"
          # Antigravity CLI home. Model cache + session state; 256M is generous.
          "/home/devuser/.antigravity:mode=755,size=256M,uid=1000,gid=1000"
          # ruflo plugins git cache. Phase 7 sparse-clones github.com/ruvnet/ruflo
          # here; plugins are then symlinked from cache into .claude-flow/plugins.
          # 512M covers the full plugin tree with room for npm artefacts.
          "/var/cache:mode=755,size=512M,uid=1000,gid=1000"
          # Writable, exec+suid-allowed bin dir for setuid wrappers (sudo).
          # The bootstrap program runs as root and provisions a setuid copy
          # of pkgs.sudo here so devuser shells can elevate via the NOPASSWD
          # rule in /etc/sudoers.d/devuser. Docker tmpfs defaults to nosuid,
          # noexec — both must be explicitly enabled.
          "/usr/local/bin:mode=755,size=8M,exec,suid"
          "/app/mcp-logs:mode=755,size=100M,uid=1000,gid=1000"
        ];
        # `builtins.seq _w021Check ...` forces evaluation of the W021 audit
        # check before mergedTmpfsMounts is computed; if W021 throws, the
        # whole compose generation fails closed.
        mergedTmpfsMounts = builtins.seq _w021Check (
          lib.unique (baselineTmpfsMounts ++ exceptionTmpfsPaths)
        );

        agentboxTmpfs =
          lib.concatMapStrings (p: "      - ${p}\n") mergedTmpfsMounts;

        agentboxDevices =
          lib.optionalString (exceptionDevicePaths != []) (
            "    devices:\n"
            + lib.concatMapStrings (d: "      - ${d}\n") exceptionDevicePaths
          );

        # Baseline caps. cap_drop: ALL removes everything, then cap_add
        # restores the minimum the bootstrap-as-root and the setuid sudo
        # wrapper need:
        #   CHOWN          chown -R 1000:1000 on freshly created named volumes
        #   FOWNER         chmod 755 on volumes (operate on uid-1000-owned files
        #                  before bootstrap runs as uid 1000)
        #   DAC_OVERRIDE   read files when ownership isn't set yet (defensive)
        #   SETUID,SETGID  setuid sudo wrapper at /usr/local/bin/sudo elevates
        #                  devuser to root via the NOPASSWD rule. Without these
        #                  caps in the bounding set, the kernel refuses the
        #                  setuid bit even with no-new-privileges:false.
        #   AUDIT_WRITE    sudo writes to the audit log on every elevation
        #   KILL           supervisord signals its child processes
        # Per ADR-007 §4a baseline + W021 audit_acknowledged: the wider
        # surface is acknowledged once at compose-eval time and documented
        # in docs/user/configuration.md §Security trade-offs.
        baselineCapAdd = [
          "CHOWN"
          "FOWNER"
          "DAC_OVERRIDE"
          "SETUID"
          "SETGID"
          "AUDIT_WRITE"
          "KILL"
        ];
        agentboxCapabilities =
          let allCaps = lib.unique (baselineCapAdd ++ exceptionCapAdd);
          in
          "    cap_drop:\n      - ALL\n"
          + "    cap_add:\n"
          + lib.concatMapStrings (c: "      - ${c}\n") allCaps;

        agentboxRuntime =
          lib.optionalString (exceptionRuntime != null) "    runtime: ${exceptionRuntime}\n";

        # Volumes list for agentbox service — deduplicated (Q10).
        # Baseline + feature-exception writable volumes are merged via
        # `lib.unique` keyed by mount target (after the colon) so that an
        # exception declaring the same target as the baseline doesn't
        # emit a duplicate Docker volume mount.
        # HOME = /home/devuser (Q19); the workspace tree lives there. Base
        # mounts `./workspace:/home/devuser/workspace` for source-tree
        # deployments; the override may swap in a named volume for
        # operator-specific workspace persistence (e.g. agentbox-workspace
        # post-MAD migration). agentbox-secrets gives the management-api
        # somewhere to write the auto-generated key under read_only:true
        # without leaking it into the shared workspace volume (Q5).
        agentboxBaselineMounts = [
          "./agentbox.toml:/etc/agentbox.toml:ro"
          "./workspace:/home/devuser/workspace"
          "./projects:/projects"
          "ruvector-data:/var/lib/ruvector"
          "solid-data:/var/lib/solid"
          "sovereign-identities:/var/lib/agentbox/identities"
          "agentbox-secrets:/var/lib/agentbox/secrets"
          "code-harness-data:/var/lib/agentbox/code-harness"
          "agentbox-events:/var/lib/agentbox/events"
        ];
        # Drop entries from exceptionWritableVolumes whose container target
        # path already appears in the baseline. Compare on the second
        # colon-separated field (target).
        _mountTarget = m:
          let parts = lib.splitString ":" m;
          in if (lib.length parts) >= 2 then lib.elemAt parts 1 else m;
        baselineTargets = map _mountTarget agentboxBaselineMounts;
        exceptionWritableVolumesUnique = lib.filter
          (m: ! (lib.elem (_mountTarget m) baselineTargets))
          (lib.unique exceptionWritableVolumes);
        agentboxVolumes =
          lib.concatMapStrings (m: "      - ${m}\n") agentboxBaselineMounts
          + lib.concatMapStrings (v: "      - ${v}\n") exceptionWritableVolumesUnique;

        # Top-level volumes block — explicit "  <name>:\n    name: ...\n"
        # per entry; the prior heredoc stripped the 2-space common indent
        # and produced flush-left volume keys.
        #
        # Baseline volumes are hardcoded; feature-exception volumes
        # (writable_volumes entries like "codeserver-config:/path/in/container")
        # are auto-derived so every volume referenced in the agentbox service's
        # volumes list has a matching top-level declaration. Without this,
        # docker compose rejects the file with "undefined volume <name>".
        baselineTopLevelVolumeNames = [ "ruvector-data" "solid-data" "sovereign-identities" "agentbox-secrets" "code-harness-data" "agentbox-events" ];
        exceptionVolumeNames = lib.unique (
          map (v: lib.head (lib.splitString ":" v)) exceptionWritableVolumes
        );
        # Feature-exception names not already covered by the baseline.
        extraTopLevelVolumeNames = lib.subtractLists baselineTopLevelVolumeNames exceptionVolumeNames;
        topLevelVolumes =
          lib.optionalString (gpuEnabled && ollamaSidecarEnabled) "  ollama:\n    name: ollama\n"
          + "  ruvector-data:\n    name: agentbox-ruvector-data\n"
          + "  solid-data:\n    name: agentbox-solid-data\n"
          + "  sovereign-identities:\n    name: agentbox-sovereign-identities\n"
          + "  agentbox-secrets:\n    name: agentbox-secrets\n"
          + lib.concatMapStrings
              (n: "  ${n}:\n    name: agentbox-${n}\n")
              extraTopLevelVolumeNames;

        # Full compose document.
        composeText = ''
# AUTO-GENERATED from agentbox.toml via flake.nix — do not edit by hand.
# Run: nix build .#compose

services:
${ollamaServiceBlock}
  agentbox:
    image: ''${AGENTBOX_IMAGE_REF:-agentbox:runtime-${system}}
    container_name: agentbox
    hostname: agentbox
    restart: unless-stopped
${agentboxDependsOn}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9090/ready"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 60s
${agentboxExtraHosts}
    ports:
${agentboxPorts}
    environment:
      - ANTHROPIC_API_KEY=''${ANTHROPIC_API_KEY:-}
      - GITHUB_TOKEN=''${GITHUB_TOKEN:-}
      - OPENAI_API_KEY=''${OPENAI_API_KEY:-ollama}
      - OPENAI_BASE_URL=''${OPENAI_BASE_URL:-${defaultLlmBaseUrl}/v1}
      - OLLAMA_BASE_URL=''${OLLAMA_BASE_URL:-${defaultLlmBaseUrl}}
      - OLLAMA_MODEL=''${OLLAMA_MODEL:-qwen2.5:32b-instruct}
      - GOOGLE_GEMINI_API_KEY=''${GOOGLE_GEMINI_API_KEY:-}
      - GEMINI_API_KEY=''${GEMINI_API_KEY:-}
      - MANAGEMENT_API_KEY=''${MANAGEMENT_API_KEY:-}
      - MANAGEMENT_API_AUTH_MODE=''${MANAGEMENT_API_AUTH_MODE:-hybrid}
      - NOSTR_RELAYS=''${NOSTR_RELAYS:-wss://relay.damus.io,wss://relay.primal.net}
      - AGENTBOX_AGENT_ID=''${AGENTBOX_AGENT_ID:-agentbox-core}
      - AGENTBOX_METRICS_PORT=${metricsPort}
      - AGENTBOX_OTLP_ENDPOINT=${observCfg.otlp_endpoint or ""}
      - AGENTBOX_LOG_LEVEL=${observCfg.log_level or "info"}
      - XINFERENCE_ENDPOINT=''${XINFERENCE_ENDPOINT:-http://xinference:9997}
      - EMBEDDING_MODEL=''${EMBEDDING_MODEL:-bge-small-en-v1.5}
    # Baseline: supervisord runs as PID 1 root, with per-program `user=devuser`
    # drops on every long-running service. Root is required at boot for
    # tmpfs subdir creation, sudoers wrapper provisioning (chown 0:0 +
    # chmod 4755), cert generation, and chowning runtime dirs to uid 1000.
    # Per ADR-007 §4a hardening posture; see PRD-003 §5.4.
    read_only: true
${agentboxRuntime}${agentboxCapabilities}
${agentboxDevices}    tmpfs:
${agentboxTmpfs}    security_opt:
      - no-new-privileges:${nnpBaselineValue}
      - seccomp=./config/seccomp-agentbox.json${securityOptOverrideEmission}
    volumes:
${agentboxVolumes}
${agentboxNetworks}

volumes:
${topLevelVolumes}
networks:
${ragflowNetworkDecl}
'';

        configFiles = pkgs.runCommand "agentbox-config" {} ''
          mkdir -p $out/etc/agentbox $out/bin
          cp ${pkgs.writeText "supervisord.conf" supervisorText} $out/etc/supervisord.conf
          cp ${./agentbox.toml} $out/etc/agentbox.toml
          cp ${pkgs.writeText "docker-compose.yml" composeText} $out/etc/agentbox/docker-compose.yml
          ${lib.optionalString relayLocal ''
          cp ${pkgs.writeText "nostr-relay.toml" relayConfigText} $out/etc/agentbox/nostr-relay.toml
          ''}

          # Non-root user: devuser (uid 1000, gid 1000)
          # Supervisord (PID 1) runs as root; interactive shells run as devuser.
          # /etc/passwd and /etc/group are seeded here; entrypoint may append at runtime.
          cat > $out/etc/passwd <<'PASSWD'
          root:x:0:0:root:/root:/bin/sh
          devuser:x:1000:1000:devuser:/home/devuser:/bin/fish
          PASSWD
          # Strip leading whitespace introduced by Nix heredoc indentation
          sed -i 's/^[[:space:]]*//' $out/etc/passwd

          cat > $out/etc/group <<'GROUP'
          root:x:0:devuser
          wheel:x:998:devuser
          devuser:x:1000:
          GROUP
          sed -i 's/^[[:space:]]*//' $out/etc/group

          # Passwordless sudo for devuser. Both /etc/sudoers and the drop-in
          # are baked into the image because the rootfs is read_only at runtime
          # — there's no place for the entrypoint to write these.
          echo "root ALL=(ALL) ALL" > $out/etc/sudoers
          echo "#includedir /etc/sudoers.d" >> $out/etc/sudoers
          chmod 440 $out/etc/sudoers
          mkdir -p $out/etc/sudoers.d
          echo "devuser ALL=(ALL) NOPASSWD: ALL" > $out/etc/sudoers.d/devuser
          chmod 440 $out/etc/sudoers.d/devuser

          # Shell-rc seeding (Q23). Baked into the image at build time so
          # interactive devuser shells consistently source the agentbox
          # aliases and bashrc snippet. Previously the entrypoint tried to
          # write these at runtime — silent no-op under read_only:true.
          cat > $out/etc/bash.bashrc <<'BASHRC'
          source /opt/agentbox/config/agentbox-aliases.sh 2>/dev/null || true
          source /opt/agentbox/config/bashrc.agentbox 2>/dev/null || true
          [ -f /run/agentbox/runtime-env.sh ] && source /run/agentbox/runtime-env.sh
          BASHRC
          sed -i 's/^[[:space:]]*//' $out/etc/bash.bashrc
          chmod 644 $out/etc/bash.bashrc

          cat > $out/etc/profile <<'PROFILE'
          source /opt/agentbox/config/bashrc.agentbox 2>/dev/null || true
          [ -f /run/agentbox/runtime-env.sh ] && source /run/agentbox/runtime-env.sh
          PROFILE
          sed -i 's/^[[:space:]]*//' $out/etc/profile
          chmod 644 $out/etc/profile

          # Q24: profile.d shim that sources the runtime env. Lives in the
          # read-only image; the runtime-env.sh source is on the writable
          # /run tmpfs and is created by entrypoint Phase 8.
          mkdir -p $out/etc/profile.d
          cat > $out/etc/profile.d/agentbox-runtime.sh <<'PRDRT'
          #!/bin/sh
          [ -f /run/agentbox/runtime-env.sh ] && . /run/agentbox/runtime-env.sh
          PRDRT
          sed -i 's/^[[:space:]]*//' $out/etc/profile.d/agentbox-runtime.sh
          chmod 755 $out/etc/profile.d/agentbox-runtime.sh

          # Fish shell config (Q23). Sourced by all interactive fish shells.
          mkdir -p $out/etc/fish
          cat > $out/etc/fish/config.fish <<'FISH'
          if test -f /opt/agentbox/config/config.fish
            source /opt/agentbox/config/config.fish
          end
          if test -f /run/agentbox/runtime-env.fish
            source /run/agentbox/runtime-env.fish
          end
          FISH
          sed -i 's/^[[:space:]]*//' $out/etc/fish/config.fish
          chmod 644 $out/etc/fish/config.fish

          # Q26: claude-flow plugin config, generated from agentbox.toml.
          # Replaces the runtime heredoc in entrypoint-unified.sh. Values
          # track the manifest, not magic constants. Password is sourced
          # from RUVECTOR_PG_PASSWORD env (with fallback) so the three-way
          # password disagreement (Q6) collapses into one source of truth.
          mkdir -p $out/opt/agentbox/config
          cp ${pkgs.writeText "claude-flow-config.json" claudeFlowConfigJson} $out/opt/agentbox/config/claude-flow-config.template.json

          # Fontconfig: Chrome's Skia font manager requires /etc/fonts/fonts.conf.
          # Without it, the GPU process crashes with SkFontMgr_FontConfigInterface
          # "Not implemented". The Nix image has no /etc/fonts by default.
          # Only list the specific font packages we ship — NOT /nix/store (that
          # indexes 500+ font dirs and generates a 500MB cache that fills tmpfs).
          mkdir -p $out/etc/fonts
          cat > $out/etc/fonts/fonts.conf <<FONTCFG
          <?xml version="1.0"?>
          <!DOCTYPE fontconfig SYSTEM "fonts.dtd">
          <fontconfig>
            <dir>${pkgs.dejavu_fonts}/share/fonts</dir>
            <dir>${pkgs.liberation_ttf}/share/fonts</dir>
            <dir>${pkgs.noto-fonts-cjk-sans}/share/fonts</dir>
            <cachedir>/var/cache/fontconfig</cachedir>
          </fontconfig>
          FONTCFG
          sed -i 's/^[[:space:]]*//' $out/etc/fonts/fonts.conf

          ${lib.optionalString isXorgNvidiaStack ''
          # Xorg + NVIDIA startup script. Auto-detects PCI BusID from the
          # first available NVIDIA GPU, generates xorg.conf, and launches Xorg
          # on display :1 with AllowEmptyInitialConfiguration for headless use.
          mkdir -p $out/opt/agentbox/config
          cat > $out/opt/agentbox/config/start-xorg-nvidia.sh <<'XORGSH'
          #!/bin/sh
          set -e
          XORG_CONF="/tmp/xorg-nvidia.conf"
          # nvidia-smi reports PCI bus in hex (e.g. 00000000:18:00.0 where 0x18=24).
          # Xorg BusID requires decimal. Convert each field explicitly.
          RAW_BUS=$(nvidia-smi --query-gpu=pci.bus_id --format=csv,noheader 2>/dev/null | head -1)
          if [ -z "$RAW_BUS" ]; then
            echo "[xorg-nvidia] No NVIDIA GPU found, falling back to PCI:24:0:0"
            PCI_BUS="PCI:24:0:0"
          else
            # Strip domain prefix, split into bus:device.function (all hex)
            BDF=$(echo "$RAW_BUS" | sed 's/[0-9a-f]*://') # strip domain
            BUS_HEX=$(echo "$BDF" | cut -d: -f1)
            DEV_HEX=$(echo "$BDF" | cut -d: -f2 | cut -d. -f1)
            FN_HEX=$(echo "$BDF" | cut -d. -f2)
            # printf %d converts hex→decimal
            BUS_DEC=$(printf "%d" "0x''${BUS_HEX}")
            DEV_DEC=$(printf "%d" "0x''${DEV_HEX}")
            FN_DEC=$(printf "%d" "0x''${FN_HEX}")
            PCI_BUS="PCI:''${BUS_DEC}:''${DEV_DEC}:''${FN_DEC}"
          fi
          # Derive Nix Xorg module path from the Xorg binary location
          XORG_BIN=$(which Xorg 2>/dev/null || echo "/usr/bin/Xorg")
          NIX_XORG_MOD=$(dirname $(dirname "$XORG_BIN"))/lib/xorg/modules
          RES="''${XORG_RESOLUTION:-1920x1080}"

          cat > "$XORG_CONF" <<XCFG
          Section "Files"
              ModulePath "$NIX_XORG_MOD"
              ModulePath "$NIX_XORG_MOD/extensions"
              ModulePath "/usr/lib/xorg/modules"
              ModulePath "/usr/lib/xorg/modules/drivers"
              ModulePath "/usr/lib/nvidia/xorg"
          EndSection

          Section "ServerLayout"
              Identifier     "Layout0"
              Screen         "Screen0"
          EndSection

          Section "Device"
              Identifier     "Device0"
              Driver         "nvidia"
              BusID          "$PCI_BUS"
              Option         "AllowEmptyInitialConfiguration" "True"
              Option         "ConnectedMonitor" "DFP-0"
          EndSection

          Section "Monitor"
              Identifier     "Monitor0"
              Option         "DPMS" "False"
          EndSection

          Section "Screen"
              Identifier     "Screen0"
              Device         "Device0"
              Monitor        "Monitor0"
              DefaultDepth    24
              SubSection     "Display"
                  Depth       24
                  Virtual     $(echo "$RES" | cut -dx -f1) $(echo "$RES" | cut -dx -f2)
              EndSubSection
          EndSection

          Section "ServerFlags"
              Option "DontVTSwitch" "True"
              Option "AllowMouseOpenFail" "True"
              Option "AutoAddDevices" "False"
              Option "AutoEnableDevices" "False"
          EndSection
          XCFG
          sed -i 's/^[[:space:]]*//' "$XORG_CONF"

          echo "[xorg-nvidia] Starting Xorg on :1 with GPU $PCI_BUS at $RES"
          # LD_LIBRARY_PATH: host NVIDIA libs (/usr/lib) are not in the Nix
          # ldconfig cache, so libglxserver_nvidia.so can't find libnvidia-tls.
          # Prepend /usr/lib so the dynamic linker resolves them at startup.
          exec env LD_LIBRARY_PATH=/usr/lib:/usr/lib/x86_64-linux-gnu''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH} \
            Xorg :1 -config "$XORG_CONF" -noreset -novtswitch -nolisten tcp +extension GLX +extension RANDR +extension MIT-SHM
          XORGSH
          sed -i 's/^[[:space:]]*//' $out/opt/agentbox/config/start-xorg-nvidia.sh
          chmod 755 $out/opt/agentbox/config/start-xorg-nvidia.sh
          ''}

          # Z.AI wrapper: 'zai' invokes Claude Code against the Z.AI API endpoint.
          ln -s /opt/agentbox/config/zai-wrapper.sh $out/bin/zai
        '';

        entrypoint = pkgs.writeShellScriptBin "entrypoint" ''
          # FHS shims (/usr/bin/env, /bin/sh, /bin/bash, /lib64/ld-linux)
          # and /etc/sudoers, /etc/bash.bashrc, /etc/fish/config.fish, and
          # /etc/profile.d/agentbox-runtime.sh are all baked into the image
          # by the appRoot + configFiles derivations above. The read_only:true
          # rootfs would block any runtime mkdir/ln-sf into these paths
          # anyway. (Q15, Q23, Q24)

          # Runtime directories for services that need writable state
          mkdir -p /var/lib/nostr-relay 2>/dev/null || true
          mkdir -p /var/lib/https-bridge/certs 2>/dev/null || true

          # Home directory for devuser bind mounts (e.g. /home/devuser/.claude)
          mkdir -p /home/devuser 2>/dev/null || true

          # Setuid sudo wrapper. The Nix-store sudo binary is mode 555 and
          # cannot elevate; copy it to the tmpfs-backed /usr/local/bin (which
          # the baseline tmpfs mount declares as exec+suid) and set the setuid
          # bit. PATH puts /usr/local/bin first so this wrapper shadows the
          # Nix-store sudo for devuser's interactive shells.
          if [ -d /usr/local/bin ] && [ ! -u /usr/local/bin/sudo ] 2>/dev/null; then
            if cp -L ${sudoNoPam}/bin/sudo /usr/local/bin/sudo 2>/dev/null; then
              chown 0:0 /usr/local/bin/sudo 2>/dev/null || true
              chmod 4755 /usr/local/bin/sudo 2>/dev/null || true
              echo "[entrypoint] Provisioned setuid sudo wrapper at /usr/local/bin/sudo"
            fi
          fi

          # Pre-generate HTTPS bridge self-signed cert if missing. The
          # tmpfs at /var/lib/https-bridge is uid-1000-owned (baselineTmpfsMounts);
          # cert files are written world-readable, key world-unreadable.
          # The bridge process (devuser) reads them at start. If this
          # block fails, the JS app has its own node:crypto fallback in
          # https-proxy.js — the cert is never sourced from the network.
          mkdir -p /var/lib/https-bridge/certs 2>/dev/null || true
          if [ ! -f /var/lib/https-bridge/certs/server.key ]; then
            ${pkgs.openssl}/bin/openssl req -x509 -newkey rsa:2048 \
              -keyout /var/lib/https-bridge/certs/server.key \
              -out /var/lib/https-bridge/certs/server.crt \
              -days 365 -nodes -subj "/CN=localhost" 2>/dev/null || true
            chown 1000:1000 /var/lib/https-bridge/certs/server.* 2>/dev/null || true
            chmod 600 /var/lib/https-bridge/certs/server.key 2>/dev/null || true
            chmod 644 /var/lib/https-bridge/certs/server.crt 2>/dev/null || true
          fi

          exec ${pkgs.bash}/bin/bash /opt/agentbox/config/entrypoint-unified.sh
        '';

        imageEnv = [
          # HOME=/home/devuser is canonical (Q19): standard FHS, matches the
          # uid the long-running services run as, and matches the existing
          # MAD volume layout when mounted at /home/devuser/workspace. The
          # earlier HOME=/workspace was a backward-compat shim from the
          # initial multi-profile design (CLAUDE.md "Shared Runtime Model"
          # — `/workspace` is shared but `$HOME` is per-user).
          "HOME=/home/devuser"
          "WORKSPACE=/home/devuser/workspace"
          "PATH=/usr/local/bin:/bin:/usr/bin:${pkgs.lib.makeBinPath allPackages}"
          "NODE_ENV=production"
          "PYTHONDONTWRITEBYTECODE=1"
          "RUST_BACKTRACE=1"
          "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
          "NIX_SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
          "AGENTBOX_CONFIG=/etc/agentbox.toml"
          "AGENTBOX_VERSION=2.0.0"
          "AGENTBOX_ORCHESTRATION=${coreCfg.orchestration or "ruflo-v3"}"
          "RUVECTOR_BACKEND=${coreCfg.vector_db or "ruvector-embedded"}"
          "RUVECTOR_DATA_DIR=/var/lib/ruvector"
          "RUVECTOR_PORT=9700"
          "MANAGEMENT_API_PORT=9090"
          "MANAGEMENT_API_AUTH_MODE=hybrid"
          # MANAGEMENT_API_KEY intentionally not set here — sourced from .env at runtime
          "SOVEREIGN_MESH_ENABLED=${boolEnv (sovereignCfg.enabled or false)}"
          "SOLID_POD_ENABLED=${boolEnv (sovereignCfg.solid_pod or false)}"
          "SOLID_POD_ROOT=/var/lib/solid"
          "SOLID_POD_PORT=8484"
          "SOLID_ADMIN_KEY=\${SOLID_ADMIN_KEY:-}"
          "SOLID_REQUIRE_NIP98=${boolEnv (sovereignCfg.enabled or false)}"
          "NOSTR_BRIDGE_ENABLED=${boolEnv (sovereignCfg.nostr_bridge or false)}"
          "NOSTR_BRIDGE_PORT=9740"
          "NOSTR_RELAYS=wss://relay.damus.io,wss://relay.primal.net"
          "XKB_CONFIG_ROOT=${pkgs.xkeyboard_config}/share/X11/xkb"
          "ENABLE_TAILSCALE=${boolEnv (networkingCfg.tailscale or false)}"
          "TAILSCALE_HOSTNAME=${networkingCfg.hostname or "agentbox"}"
          "ENABLE_DESKTOP=${boolEnv (desktopCfg.enabled or false)}"
          "DESKTOP_STACK=${desktopCfg.stack or "i3-x11"}"
          "DESKTOP_WEBGPU=${boolEnv webgpuEnabled}"
          # WLR_BACKENDS: default headless (safe for containers without DRM).
          # Override to "drm" in docker-compose when NVIDIA_DRIVER_CAPABILITIES
          # includes "graphics" and /dev/dri/card0 is mapped in for GPU mode.
          "WLR_BACKENDS=headless"
          "ENABLE_AGENT_BROWSER=${boolEnv (browserCfg.agent_browser or false)}"
          "ENABLE_PLAYWRIGHT=${boolEnv (browserCfg.playwright or false)}"
          "ENABLE_QE_BROWSER=${boolEnv (browserCfg.qe_browser or false)}"
          "ENABLE_FFMPEG=${boolEnv (mediaCfg.ffmpeg or false)}"
          "ENABLE_IMAGEMAGICK=${boolEnv (mediaCfg.imagemagick or false)}"
          "ENABLE_COMFYUI_BUILTIN=${boolEnv (mediaCfg.comfyui_builtin or false)}"
          "ENABLE_COMFYUI_EXTERNAL=${boolEnv (comfyuiExtCfg.enabled or false)}"
          # When external path is active, publish URLs so the MCP server can pick them up.
          # Built-in path always listens on localhost:8188 — MCP server should use 127.0.0.1.
          "COMFYUI_URL=${
            if (comfyuiExtCfg.enabled or false)
            then (comfyuiExtCfg.url or "http://comfyui:8188")
            else "http://127.0.0.1:8188"
          }"
          "COMFYUI_WS_URL=${
            if (comfyuiExtCfg.enabled or false)
            then (comfyuiExtCfg.ws_url or "ws://comfyui:8188/ws")
            else "ws://127.0.0.1:8188/ws"
          }"
          "ENABLE_QGIS=${boolEnv (spatialCfg.qgis or false)}"
          "ENABLE_BLENDER=${boolEnv (spatialCfg.blender or false)}"
          "ENABLE_PYTORCH=${boolEnv (dataScienceCfg.pytorch or false)}"
          "ENABLE_JUPYTER=${boolEnv (dataScienceCfg.jupyter or false)}"
          "ENABLE_LATEX=${boolEnv (docsCfg.latex or false)}"
          "ENABLE_REPORT_BUILDER=${boolEnv (docsCfg.report_builder or false)}"
          "ENABLE_MERMAID=${boolEnv (docsCfg.mermaid or false)}"
          # ── Code-as-Harness (PRD-008) ─────────────────────────────────────
          "ENABLE_CODE_INTERPRETER=${boolEnv (codeInterpreterCfg.enabled or false)}"
          "ENABLE_CODEACT_SKILL=${boolEnv ((skillsCfg.codeact or {}).enabled or false)}"
          "ENABLE_EXPEL=${boolEnv ((agentboxConfig.features or {}).expel_lesson_extraction.enabled or false)}"
          "ENABLE_VOYAGER=${boolEnv ((skillsCfg.voyager_skill_library or {}).enabled or false)}"
          "ENABLE_ACI_SHELL=${boolEnv ((skillsCfg.aci_shell or {}).enabled or false)}"
          "ENABLE_TREE_SEARCH_CODER=${boolEnv ((skillsCfg.tree_search_coder or {}).enabled or false)}"
          "ENABLE_ONTOLOGY=${boolEnv ((skillsCfg.ontology or {}).enabled or false)}"
          "VISIONCLAW_API_URL=${(skillsCfg.ontology or {}).visionclaw_api_url or "http://visionclaw-server:4000"}"
          # PRD-014 D2: ungoverned ontology_axiom_add backdoor, off by default.
          "AGENTBOX_ONTOLOGY_DIRECT_LOAD=${boolEnv ((skillsCfg.ontology or {}).direct_axiom_load or false)}"
          "AGENTBOX_KERNEL_WHEELHOUSE=/var/lib/agentbox/code-interpreter-wheelhouse"
          "AGENTBOX_CODE_HARNESS_DIR=/var/lib/agentbox/code-harness"
          # ─────────────────────────────────────────────────────────────────
          "ENABLE_CLAUDE=${boolEnv (toolchainCfg.claude or false)}"
          "ENABLE_CLAUDE_CODE=${boolEnv (toolchainCfg.claude_code or false)}"
          "ENABLE_RUFLO=${boolEnv (toolchainCfg.ruflo or false)}"
          "ENABLE_CLAUDE_FLOW=${boolEnv (toolchainCfg.claude_flow or false)}"
          "ENABLE_AGENTIC_QE=${boolEnv (toolchainCfg.agentic_qe or false)}"
          "ENABLE_NAGUAL_QE=${boolEnv (toolchainCfg.nagual_qe or false)}"
          "ENABLE_CODEBASE_MEMORY=${boolEnv (toolchainCfg.codebase_memory or false)}"
          "ENABLE_RUST_TOOLCHAIN=${boolEnv (toolchainCfg.rust or false)}"
          "CARGO_HOME=/home/devuser/workspace/.cargo"
          "RUSTUP_HOME=/home/devuser/workspace/.rustup"
          "TMPDIR=/home/devuser/workspace/.tmp"
          "OPENSSL_DIR=${pkgs.openssl}"
          "OPENSSL_LIB_DIR=${pkgs.openssl.out}/lib"
          "OPENSSL_INCLUDE_DIR=${pkgs.openssl.dev}/include"
          "ENABLE_ANTIGRAVITY_CLI=${boolEnv (toolchainCfg.antigravity_cli or false)}"
          "ENABLE_CODEX=${boolEnv (toolchainCfg.codex or false)}"
          "CODEX_HOME=/home/devuser/.codex"
          "GIT_CONFIG_GLOBAL=/home/devuser/.config/git/config"
          "CLAUDE_FLOW_PLUGIN_DIR=/home/devuser/.claude-flow/plugins"
          "RUVECTOR_PG_CONNINFO=${(agentboxConfig.integrations.ruvector_external.conninfo or "")}"
          # WORKSPACE intentionally NOT re-set here — the canonical value
          # is set earlier in imageEnv as /home/devuser/workspace.
          # Re-asserting it here would shadow the earlier value (the last
          # entry in imageEnv wins via Docker env merge).
          "SHARED_PROJECTS_ROOT=/projects"
          "AGENTBOX_AGENT_ID=agentbox-core"
          # CLAUDE_CONFIG_DIR points at the host-bind .claude. The
          # previous /workspace/.claude path was a relic from when
          # HOME=/workspace; it now resolves nowhere and silently breaks
          # `claude --dangerously-skip-permissions` init.
          "CLAUDE_CONFIG_DIR=/home/devuser/.claude"
          "SKILLS_TREE=/opt/agentbox/skills"
          "GPU_BACKEND=${agentboxConfig.gpu.backend or "none"}"
          # Privacy filter (ADR-008) — non-empty OPF_ENABLED signals the
          # adapter middleware to route through the opf-router sidecar.
          "OPF_ENABLED=${boolEnv privacyFilterEnabled}"
          "OPF_PORT=${toString (privacyFilterCfg.port or 9092)}"
          "OPF_MODE=${privacyFilterCfg.mode or "off"}"
          "OPF_POLICY_PODS=${(privacyFilterCfg.policy or {}).pods or "strict"}"
          "OPF_POLICY_MEMORY=${(privacyFilterCfg.policy or {}).memory or "strict"}"
          # Memory access control (ADR-008 §memory gating) — baked from [memory] in agentbox.toml.
          # "permissive" = admin Bearer callers see all namespaces; "scoped" = all callers isolated.
          "MEMORY_ADMIN_ACCESS_MODE=${memoryCfg.admin_access_mode or "scoped"}"
          "OPF_POLICY_EVENTS=${(privacyFilterCfg.policy or {}).events or "soft"}"
          "OPF_POLICY_BEADS=${(privacyFilterCfg.policy or {}).beads or "soft"}"
          "OPF_POLICY_ORCHESTRATOR=${(privacyFilterCfg.policy or {}).orchestrator or "off"}"
          "OPF_POLICY_INBOUND=${(privacyFilterCfg.policy or {}).inbound or "soft"}"
          "OPF_POLICY_OUTBOUND=${(privacyFilterCfg.policy or {}).outbound or "soft"}"
          # Embedded Nostr relay (ADR-009 / PRD-004) — env surface for
          # management-api's bridge consumer and health probe.
          "AGENTBOX_RELAY_ENABLED=${boolEnv relayEnabled}"
          "AGENTBOX_RELAY_IMPL=${relayImpl}"
          "AGENTBOX_RELAY_PORT=${toString (relayCfg.port or 7777)}"
          "AGENTBOX_RELAY_BIND=${relayCfg.bind or "127.0.0.1"}"
          "AGENTBOX_RELAY_DATA_DIR=${relayCfg.data_dir or "/var/lib/nostr-relay"}"
          "AGENTBOX_RELAY_POLICY=${relayCfg.ingress_policy or "allowlist"}"
          "AGENTBOX_RELAY_POD_BRIDGE=${boolEnv (relayCfg.pod_bridge or true)}"
          "AGENTBOX_RELAY_FANOUT=${relayCfg.external_fanout or "off"}"
          "AGENTBOX_RELAY_RETENTION_DAYS=${toString (relayCfg.retention_days or 30)}"
          # PRD-014 Seam B — voice-origin intent dispatch (B3) + emit auth (B4).
          "AGENTBOX_INTENT_COMMAND=${relayCfg.intent_command or ""}"
          "AGENTBOX_INTENT_ARGS=${relayCfg.intent_args or ""}"
          "AGENTBOX_AGENT_EVENT_AUTH=${relayCfg.agent_event_auth or "off"}"
          # Observability — sourced from [observability] in agentbox.toml
          "AGENTBOX_METRICS_PORT=${metricsPort}"
          "AGENTBOX_OTLP_ENDPOINT=${observCfg.otlp_endpoint or ""}"
          "AGENTBOX_LOG_LEVEL=${observCfg.log_level or "info"}"
        ]
        # Merge GPU-specific env vars (e.g. CUDA_VISIBLE_DEVICES for local-cuda)
        # into the image environment using "KEY=VALUE" string form.
        ++ lib.mapAttrsToList (k: v: "${k}=${v}") gpuCfg.supervisorExtraEnv;

        commonPorts = {
          "9090/tcp" = {};
          "9700/tcp" = {};
          "${metricsPort}/tcp" = {};
        };

        sovereignPorts = lib.optionalAttrs (sovereignCfg.enabled or false) {
          "8484/tcp" = {};
        };

        desktopPorts = lib.optionalAttrs (desktopCfg.enabled or false) {
          "5901/tcp" = {};
          "9222/tcp" = {};
        };

        dataSciencePorts = lib.optionalAttrs (dataScienceCfg.jupyter or false) {
          "8888/tcp" = {};
        };

        # PRD-010 F17: expose the embedded relay port when
        # [sovereign_mesh.relay].expose = true (federated mode).
        relayPorts = lib.optionalAttrs (relayEnabled && (relayCfg.expose or false)) {
          "${toString (relayCfg.port or 7777)}/tcp" = {};
        };

        mkImage = { tag, extraPackages ? [], maxLayers ? 100 }:
          n2c.buildImage {
            name = "agentbox";
            inherit tag maxLayers;
            layers = [
              (n2c.buildLayer { deps = basePackages; })
              (n2c.buildLayer { deps = nodeEnvPackages ++ pythonBasePackages; })
              (n2c.buildLayer { deps = [ rustToolchain rustNightlyToolchain pkgs.pkgsStatic.stdenv.cc pkgs.musl ] ++ wasmPackages ++ dbPackages; })
              (n2c.buildLayer { deps = mediaPackages ++ browserPackages ++ spatialPackages ++ dataSciencePackages ++ docsPackages ++ desktopPackages ++ extraPackages; })
            ];
            copyToRoot = pkgs.buildEnv {
              name = "agentbox-root";
              paths = [ entrypoint configFiles appRoot ];
              # /usr/bin and /lib64 are required so the FHS shims baked into
              # appRoot (env, ld-linux) survive the buildEnv merge — the
              # entrypoint's runtime fallback can't write here under
              # read_only:true rootfs.
              pathsToLink = [ "/bin" "/etc" "/opt" "/usr" "/lib64" ];
            };
            config = {
              Entrypoint = [ "${entrypoint}/bin/entrypoint" ];
              Env = imageEnv;
              WorkingDir = "/home/devuser/workspace";
              ExposedPorts = commonPorts // sovereignPorts // desktopPorts // dataSciencePorts // relayPorts;
              Labels = {
                "org.opencontainers.image.title" = "Agentbox";
                "org.opencontainers.image.description" = "Agentbox modular sovereign agent environment";
                "org.opencontainers.image.source" = "https://github.com/DreamLab-AI/agentbox";
                "org.opencontainers.image.version" = "2.0.0";
                "org.opencontainers.image.architecture" = system;
              };
            };
          };
      in
      {
        # Container-image outputs are Linux-only.
        # On darwin we expose only the manifest-generator (compose) and dev
        # shell; operators use Docker Desktop to pull the published multi-arch
        # image (see docs/guides/platforms.md).
        packages = lib.optionalAttrs pkgs.stdenv.isLinux {
          runtime = mkImage { tag = "runtime-${system}"; };
          full = mkImage {
            tag = "full-${system}";
            maxLayers = 120;
            extraPackages = allPackages;
          };
          desktop = mkImage {
            tag = "desktop-${system}";
            maxLayers = 125;
            extraPackages = desktopPackages;
          };
          default = mkImage { tag = "runtime-${system}"; };

          # cuda-runtime — runtime image with CUDA 13.1 toolchain baked in.
          # Only meaningful on x86_64-linux; aarch64 builds succeed but the
          # CUDA packages are omitted (lib.optionals stdenv.isx86_64 in
          # lib/gpu-backend.nix).
          #
          # Prerequisite: agentbox.toml must set
          #   [gpu]  backend = "local-cuda"
          #   [toolchains] cuda = true
          # to activate the extended cudaPackages_13_1 set.  Building this
          # output with the default agentbox.toml (backend="none") will
          # produce an image identical to `runtime` — use a cuda-specific
          # manifest overlay instead.
          #
          # Build:  nix build .#cuda-runtime
          # Load:   docker load < result
          cuda-runtime =
            let
              cudaLib = import ./lib/gpu-backend.nix { inherit lib pkgs; };
              cudaCfg = cudaLib.dispatchGpuBackend "local-cuda" true;
            in
            mkImage {
              tag          = "cuda-runtime-${system}";
              extraPackages = cudaCfg.nixPackages;
              maxLayers    = 110;
            };

          # gaussian-splatting — CUDA runtime image with the 3DGS stack layered on top.
          #
          # Prerequisites in agentbox.toml:
          #   [gpu]               backend = "local-cuda"
          #   [skills.spatial_and_3d]  gaussian_splatting = true
          #
          # E006 must pass (validated by scripts/agentbox-config-validate.js).
          # On aarch64 the 3DGS derivations degrade to empty dirs; the image
          # builds but the tools will not be present.
          #
          # Build:  nix build .#gaussian-splatting
          # Load:   docker load < result
          gaussian-splatting =
            let
              cudaLib  = import ./lib/gpu-backend.nix { inherit lib pkgs; };
              cudaCfg  = cudaLib.dispatchGpuBackend "local-cuda" true;
              gs3dDrvs = (import ./lib/3dgs-stack.nix { inherit lib pkgs; })
                           .makeGaussianSplattingPackages { inherit system; };
            in
            mkImage {
              tag           = "gaussian-splatting-${system}";
              extraPackages = cudaCfg.nixPackages ++ gs3dDrvs;
              maxLayers     = 115;
            };

        } // {
          # Cross-platform outputs (Linux + darwin).
          # `compose` generates the manifest-driven docker-compose.yml from
          # agentbox.toml — pure text generation, no container build, so it
          # evaluates cleanly on any system nix runs on (incl. macOS).
          # Usage: nix build .#compose && cat result/docker-compose.yml
          compose = pkgs.runCommand "agentbox-compose" {} ''
            mkdir -p $out
            cp ${pkgs.writeText "docker-compose.yml" composeText} $out/docker-compose.yml
          '';
        };

        devShells.default = pkgs.mkShell {
          buildInputs = allPackages ++ [
            pkgs.nix
            n2c.nix2container
            # Nix developer tools
            pkgs.nurl      # generate fetchFromGitHub/fetchCrate calls with pre-computed hashes
            pkgs.statix    # lint Nix files for antipatterns
            pkgs.nix-init  # scaffold buildRustPackage/buildPythonPackage expressions from URLs
          ];

          shellHook = ''
            echo "Agentbox development shell"
            echo "Manifest: agentbox.toml"
            echo "Build runtime: nix build .#runtime"
            echo "Build desktop: nix build .#desktop"
          '';
        };
      });
}
