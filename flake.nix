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
            permittedInsecurePackages = [ "python3.12-ecdsa-0.19.1" ];
          };
        };

        lib = pkgs.lib;
        n2c = nix2container.packages.${system}.nix2container;

        agentboxConfig = builtins.fromTOML (builtins.readFile ./agentbox.toml);
        coreCfg = agentboxConfig.core or {};
        sovereignCfg = agentboxConfig.sovereign_mesh or {};
        desktopCfg = agentboxConfig.desktop or {};
        skillsCfg = agentboxConfig.skills or {};
        toolchainCfg = agentboxConfig.toolchains or {};
        browserCfg = skillsCfg.browser or {};
        mediaCfg = skillsCfg.media or {};
        spatialCfg = skillsCfg.spatial_and_3d or {};
        dataScienceCfg = skillsCfg.data_science or {};
        docsCfg = skillsCfg.docs or {};
        securityCfg = agentboxConfig.security or {};
        securityExceptions = securityCfg.exceptions or {};
        privacyFilterCfg = agentboxConfig.privacy_filter or {};
        relayCfg = (sovereignCfg.relay or {});
        adaptersCfgTop = agentboxConfig.adapters or {};
        solidPodRsCfg  = (agentboxConfig.integrations or {}).solid_pod_rs or {};
        podsImpl       = adaptersCfgTop.pods or "local-solid-rs";
        solidPodRsActive = podsImpl == "local-solid-rs";

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
        #    nix-prefetch-url https://registry.npmjs.org/ruvector/-/ruvector-0.2.23.tgz
        ruvectorPkg = mkNpmCli {
          pkgName         = "ruvector";
          version         = "0.2.23";
          sha256          = "sha256-IUSAj/MLpdBt2N/joQ1n6QM/u5gVA+1CMCO++hV+dfY=";
          nodeModulesHash = "sha256-rUua0WWq+oCvDkE0WAPTD9yR+V/K26ddT0zh1/8n2ds=";
          bin             = "ruvector";
        };

        # 2. @claude-flow/cli — gated by toolchains.claude_flow.
        #    nix-prefetch-url https://registry.npmjs.org/%40claude-flow/cli/-/cli-3.5.80.tgz
        claudeFlowPkg = mkNpmCli {
          pkgName         = "@claude-flow/cli";
          version         = "3.5.80";
          sha256          = "sha256-7egZQtT2iKVXtrPWByc1zk9/TLbcDKO1nr+B+sqeQ88=";
          nodeModulesHash = "sha256-ljyvHQgDBD7x+M2w64lxTkqmsKueUaiEklmjFsbARIc=";
          bin             = "claude-flow";
        };

        # 3. ruflo — gated by toolchains.ruflo.
        #    nix-prefetch-url https://registry.npmjs.org/ruflo/-/ruflo-3.5.80.tgz
        rufloPkg = mkNpmCli {
          pkgName         = "ruflo";
          version         = "3.5.80";
          sha256          = "sha256-7/e9G/Ggm+MB6TwAEnxUZ7pe9qCDp5qrm5v4fF6fq4I=";
          nodeModulesHash = "sha256-WEw+K1c99z93/AU8H7LxAoZCwXnRrSv/gCnidZrLRZg=";
          bin             = "ruflo";
        };

        # 4. agentic-qe — gated by toolchains.agentic_qe.
        #    DEFERRED SIDE EFFECT: `aqe init --auto` writes user config and agent
        #    templates to $HOME/.claude/agents/ — it must run as the runtime user
        #    after container start, NOT at Nix build time. Add to agentbox.sh init:
        #      [[ "${ENABLE_AGENTIC_QE:-false}" == "true" ]] && aqe init --auto || true
        #    nix-prefetch-url https://registry.npmjs.org/agentic-qe/-/agentic-qe-3.9.15.tgz
        agenticQePkg = mkNpmCli {
          pkgName         = "agentic-qe";
          version         = "3.9.15";
          sha256          = "sha256-9CjwZt9bbJCIxyR8qy1snrXdAIAppxMiqwg5NooukVg=";
          nodeModulesHash = "sha256-ZaBxUp2GUu7IZWTVSMaECgfzo+5jXhBTEEXv21Y8NHs=";
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
          version         = "0.6.0";
          sha256          = "sha256-aZ2msekZEaO/CHAGSLiFtkyZKNZnEhCVNOyKVEf3FYk=";
          nodeModulesHash = "sha256-r9XtljjygaBEsRwCKKyd8KM5WWDVovz66SB0StudBE8=";
          bin             = "codebase-memory-mcp";
        };

        # 7. agent-browser — gated by skills.browser.agent_browser.
        #    CHROME_PATH injected via extraEnv so agent-browser finds Nix-store Chromium.
        #    nix-prefetch-url https://registry.npmjs.org/agent-browser/-/agent-browser-0.26.0.tgz
        agentBrowserPkg = mkNpmCli {
          pkgName         = "agent-browser";
          version         = "0.26.0";
          sha256          = "sha256-ikjPQRDX3CwSwcTW0l4Lq9+jFgS1N/Bd8NyDX+L4VL8=";
          nodeModulesHash = "sha256-UH8DzadtsBJZXyrDxlVdhECqCnjLrHmu/9KQoGT0/Ds=";
          bin             = "agent-browser";
          extraEnv = {
            CHROME_PATH = "${pkgs.chromium}/bin/chromium";
          };
        };

        # 8. playwright CLI — gated by skills.browser.playwright.
        #    PLAYWRIGHT_BROWSERS_PATH uses nixpkgs browsers; no download at runtime.
        #    Distinct from skills/playwright/mcp-server (local project, Phase 1).
        #    nix-prefetch-url https://registry.npmjs.org/playwright/-/playwright-1.59.1.tgz
        playwrightCliPkg = mkNpmCli {
          pkgName         = "playwright";
          version         = "1.59.1";
          sha256          = "sha256-emiKclkp8jJbNFmXhFscpQrOd5jnauSbYVFvg+CDiO8=";
          nodeModulesHash = "sha256-Tza83dU5GfNrV+MqZpfmIhBa3t0LLq1YLRgsO2St4U8=";
          bin             = "playwright";
          extraEnv = {
            PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
          };
        };

        # 9. @mermaid-js/mermaid-cli — gated by skills.docs.mermaid.
        #    Binary name is mmdc (upstream convention).
        #    nix-prefetch-url https://registry.npmjs.org/%40mermaid-js/mermaid-cli/-/mermaid-cli-11.12.0.tgz
        mermaidCliPkg = mkNpmCli {
          pkgName         = "@mermaid-js/mermaid-cli";
          version         = "11.12.0";
          sha256          = "sha256-xZ4rfsAQ16J6RbSt3N6Xl4xkSx6ZZgnjlxTqUtiSaDc=";
          nodeModulesHash = "sha256-yPmuT8irpdqxR3RrGcm43eT/Dnz56VURy0EWi2jZVQg=";
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
          ++ lib.optionals (browserCfg.agent_browser or false)     [ agentBrowserPkg ]
          ++ lib.optionals (browserCfg.playwright or false)        [ playwrightCliPkg ]
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
          # Prefetched 2026-04-26. Refresh: nix run nixpkgs#prefetch-npm-deps -- management-api/package-lock.json
          npmDepsHash = "sha256-S6XkG8YM8IQGoafVkOpYw/u4fC6wf3axBBcX0WjYAAA=";
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

        # 5. skills/playwright/mcp-server — gated by skills.browser.playwright.
        # PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 prevents the npm postinstall script
        # from fetching browsers; browsers are supplied by pkgs.playwright-driver.browsers.
        playwrightMcpPkg = npmServicesLib.makeNpmService {
          name        = "playwright-mcp";
          src         = ./skills/playwright/mcp-server;
          entry       = "server.js";
          extraEnv    = { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"; };
          # Prefetched 2026-04-24. Refresh: nix run nixpkgs#prefetch-npm-deps -- skills/playwright/mcp-server/package-lock.json
          npmDepsHash = "sha256-Ix5YV1W54KYyc5fGS1DjpyfrUlX1Qjzt6cJcPetT7wM=";
        };

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
          npmDepsHash = "sha256-ph18TjfLha5ltqsqo1d2cjrqqYS6jB+FD0DlNqyG0Hw=";
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
        # pattern used for codexPackages, geminiCliPackages, etc.
        npmServicePackages =
          # management-api is always included
          [ managementApiPkg ]
          # nostr-bridge: when sovereign_mesh.enabled (same gate as supervisord block)
          ++ lib.optionals (sovereignCfg.enabled or false) [ nostrBridgePkg ]
          # openai-codex MCP server: when toolchains.codex enabled
          ++ lib.optionals (toolchainCfg.codex or false) [ codexMcpPkg ]
          # lazy-fetch MCP: when ruflo or claude_flow enabled
          ++ lib.optionals ((toolchainCfg.ruflo or false) || (toolchainCfg.claude_flow or false)) [ lazyFetchMcpPkg ]
          # playwright MCP: when skills.browser.playwright enabled
          ++ lib.optionals (browserCfg.playwright or false) [ playwrightMcpPkg ]
          # comfyui MCP: when skills.media.comfyui_builtin enabled
          ++ lib.optionals (mediaCfg.comfyui_builtin or false) [ comfyuiMcpPkg ]
          # Consultants: ship the full bundle when the master gate is on.
          # Per-consultant runtime gating lives in [consultants.<name>].enabled.
          ++ lib.optionals ((agentboxConfig.consultants or {}).enabled or false) [ consultantsPkg ];

        boolEnv = value: if value then "true" else "false";

        basePackages = with pkgs; [
          bash
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
          zellij
          vim
          nano
          unzip
          zip
          gzip
          xz
          htop
          ncdu
          procps
          openssh
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

        geminiCliPackages = lib.optionals (toolchainCfg.gemini_cli or false) (with pkgs; [
          nodejs_20
        ]);

        # OpenAI Codex Rust-native CLI — pinned upstream release asset.
        # See lib/codex-binary.nix for the per-arch sha256s and version bump
        # procedure.  Binary is statically linked (musl) so no runtime deps
        # are required beyond what the container already has.
        codexLib = import ./lib/codex-binary.nix { inherit lib pkgs; };
        codexPackages = lib.optionals
          ((toolchainCfg.codex or false) && pkgs.stdenv.isLinux)
          [ (codexLib.makeCodex system) ];

        # Runtime Python environment for bootstrap scripts and local helpers.
        # Use python.withPackages so every dep is on the interpreter's import
        # path inside the container — listing them as standalone derivations
        # in `allPackages` only puts them on $PATH and leaves
        # `import ecdsa` failing with ModuleNotFoundError at bootstrap time
        # (which crash-loops the container on first start).
        # sovereign-bootstrap.py imports ecdsa directly; provision-agent-stacks.py
        # imports yaml, requests, etc. — all must resolve via this interpreter.
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

        pythonBasePackages = [
          pythonRuntimeEnv
        ];

        rustToolchain = pkgs.rust-bin.stable.latest.minimal.override {
          extensions = [ "rust-src" "clippy" "rustfmt" ];
          targets = [ "wasm32-unknown-unknown" ];
        };

        wasmPackages = with pkgs; [
          wasm-pack
          wasm-bindgen-cli
          binaryen
        ];

        dbPackages = with pkgs; [
          sqlite
        ];

        browserPackages = lib.optionals (browserCfg.agent_browser or false || browserCfg.playwright or false || browserCfg.qe_browser or false) (with pkgs; [
          chromium
          playwright-driver
          at-spi2-atk
          cups
          mesa
          libdrm
          alsa-lib
          nss
          nspr
        ]);

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
        # Source: github.com/DreamLab-AI/solid-pod-rs (AGPL-3.0-only; binary-
        # aggregation under AGPL §5 keeps agentbox MPL-2.0 — see
        # docs/developer/licensing.md). Derivation module in lib/solid-pod-rs.nix
        # uses fakeHash placeholders that surface prefetch commands at realisation.
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

        desktopPackages = lib.optionals (desktopCfg.enabled or false) (with pkgs; [
          tigervnc              # Xvnc: X server + VNC in one binary (correct XKB paths)
          xorg.xkbcomp          # runtime keymap compilation
          xorg.xauth
          xorg.xset
          xorg.xdpyinfo
          xorg.xprop
          xorg.xwininfo
          xorg.setxkbmap
          xkeyboard_config
          openbox
          tint2
          xterm
          xfce.xfce4-terminal
          dejavu_fonts
          liberation_ttf
          noto-fonts-cjk-sans
          fontconfig
          xdotool
          xclip
          scrot
          feh
          pcmanfm
        ]);

        allPackages =
          basePackages
          ++ nodeEnvPackages
          ++ pythonBasePackages
          ++ [ rustToolchain ]
          ++ wasmPackages
          ++ dbPackages
          ++ browserPackages
          ++ mediaPackages
          ++ spatialPackages
          ++ dataSciencePackages
          ++ docsPackages
          ++ privacyFilterPackages
          ++ relayPackages
          ++ solidPodRsPackages
          ++ nagualQePackages
          ++ desktopPackages
          ++ geminiCliPackages
          ++ codexPackages
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
          ${lib.optionalString (toolchainCfg.codex or false) ''
          mkdir -p $out/opt/agentbox/skills/openai-codex
          cp -rL ${codexMcpPkg}/package $out/opt/agentbox/skills/openai-codex/mcp-server
          ''}
          ${lib.optionalString ((toolchainCfg.ruflo or false) || (toolchainCfg.claude_flow or false)) ''
          mkdir -p $out/opt/agentbox/skills/lazy-fetch
          cp -rL ${lazyFetchMcpPkg}/package $out/opt/agentbox/skills/lazy-fetch/mcp-server
          ''}
          ${lib.optionalString (browserCfg.playwright or false) ''
          mkdir -p $out/opt/agentbox/skills/playwright
          cp -rL ${playwrightMcpPkg}/package $out/opt/agentbox/skills/playwright/mcp-server
          ''}
          ${lib.optionalString (mediaCfg.comfyui_builtin or false) ''
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
        '';

        qgisServiceBlock = ''
[program:qgis-mcp]
command=${pkgs.python312}/bin/python3 -u /opt/agentbox/scripts/qgis_mcp_standalone.py
directory=/opt/agentbox/scripts
autostart=true
autorestart=true
priority=230
stdout_logfile=/var/log/qgis-mcp.log
stderr_logfile=/var/log/qgis-mcp.error.log
        '';

        blenderServiceBlock = ''
[program:blender-mcp]
command=${pythonRuntimeEnv}/bin/python3 -u /opt/agentbox/skills/blender/addon/server.py
directory=/opt/agentbox/skills/blender/addon
environment=HOME="/workspace"
autostart=true
autorestart=true
priority=231
stdout_logfile=/var/log/blender-mcp.log
stderr_logfile=/var/log/blender-mcp.error.log
        '';

        jupyterServiceBlock = ''
[program:jupyter-lab]
command=${pkgs.python312Packages.jupyterlab}/bin/jupyter-lab --ip=0.0.0.0 --port=8888 --no-browser --ServerApp.token=
directory=/workspace
environment=HOME="/workspace"
autostart=true
autorestart=true
priority=232
stdout_logfile=/var/log/jupyter-lab.log
stderr_logfile=/var/log/jupyter-lab.error.log
        '';

        # Desktop via TigerVNC Xvnc — single binary replaces Xvfb + x11vnc.
        # Xvnc builds xkbcomp paths into its own derivation closure, avoiding
        # the XKB path mismatch that breaks standalone Xvfb in nix2container.
        desktopBlocks = ''
[program:xvnc]
command=${pkgs.tigervnc}/bin/Xvnc :1 -geometry ${(desktopCfg.resolution or "1920x1080")} -depth 24 -SecurityTypes None -ac -xkbdir ${pkgs.xkeyboard_config}/share/X11/xkb -pn -rfbport 5901 -localhost
environment=PATH="${pkgs.xorg.xkbcomp}/bin:%(ENV_PATH)s",XKB_CONFIG_ROOT="${pkgs.xkeyboard_config}/share/X11/xkb"
autostart=true
autorestart=true
priority=40
stdout_logfile=/var/log/xvnc.log
stderr_logfile=/var/log/xvnc.error.log

[program:openbox]
command=${pkgs.openbox}/bin/openbox
environment=DISPLAY=":1",HOME="/workspace"
autostart=true
autorestart=true
startsecs=3
priority=41
stdout_logfile=/var/log/openbox.log
stderr_logfile=/var/log/openbox.error.log
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
environment=AGENTBOX_BOOTSTRAP_STAGE="B"
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
environment=HOME="/workspace",MANAGEMENT_API_PORT="%(ENV_MANAGEMENT_API_PORT)s",MANAGEMENT_API_KEY="%(ENV_MANAGEMENT_API_KEY)s",MANAGEMENT_API_AUTH_MODE="%(ENV_MANAGEMENT_API_AUTH_MODE)s",AGENTBOX_REQUIRED_FOR_READINESS="true"
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
autostart=true
autorestart=false
startsecs=0
priority=99
environment=SUPERVISORD_CONF="/etc/supervisord.conf",BOOTSTRAP_SEAL_TIMEOUT="120"
stdout_logfile=/var/log/bootstrap-seal.log
stderr_logfile=/var/log/bootstrap-seal.error.log
${lib.optionalString ((sovereignCfg.enabled or false) && solidPodRsActive) ''

[program:solid-pod]
command=${solidPodRsPkg}/bin/solid-pod-rs-server
directory=${solidPodRsCfg.storage_root or "/var/lib/solid"}
environment=HOME="/workspace",JSS_HOST="${solidPodRsCfg.bind or "127.0.0.1"}",JSS_PORT="${toString (solidPodRsCfg.port or 8484)}",JSS_BASE_URL="${solidPodRsCfg.base_url or "http://127.0.0.1:8484"}",JSS_STORAGE_ROOT="${solidPodRsCfg.storage_root or "/var/lib/solid"}",JSS_LOG_LEVEL="${solidPodRsCfg.log_level or "info"}",RUST_LOG="${solidPodRsCfg.log_level or "info"}",JSS_ENABLE_DID_NOSTR="${boolEnv (solidPodRsCfg.enable_did_nostr or true)}",JSS_ENABLE_RATE_LIMIT="${boolEnv (solidPodRsCfg.enable_rate_limit or true)}",JSS_RATE_LIMIT_PER_SEC="${toString (solidPodRsCfg.rate_limit_per_sec or 20)}",JSS_ENABLE_QUOTA="${boolEnv (solidPodRsCfg.enable_quota or true)}",JSS_QUOTA_DEFAULT_BYTES="${toString (solidPodRsCfg.quota_default_bytes or 10737418240)}",JSS_ENABLE_WEBHOOK_SIGNING="${boolEnv (solidPodRsCfg.enable_webhook_signing or true)}",JSS_V04_COMPAT="${boolEnv (solidPodRsCfg.jss_v04_compat or true)}",AGENTBOX_REQUIRED_FOR_READINESS="true"
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
environment=HOME="/workspace",MANAGEMENT_API_PORT="%(ENV_MANAGEMENT_API_PORT)s"
autostart=true
autorestart=true
priority=32
stdout_logfile=/var/log/https-bridge.log
stderr_logfile=/var/log/https-bridge.error.log
''}
${lib.optionalString (browserCfg.playwright or false) ''

[program:playwright-mcp]
command=${playwrightMcpPkg}/bin/playwright-mcp
directory=/opt/agentbox/skills/playwright/mcp-server
environment=HOME="/workspace",PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
autostart=true
autorestart=true
priority=200
stdout_logfile=/var/log/playwright-mcp.log
stderr_logfile=/var/log/playwright-mcp.error.log
''}
${lib.optionalString (mediaCfg.imagemagick or false) ''

[program:imagemagick-mcp]
command=${pkgs.bash}/bin/bash -c "${pythonRuntimeEnv}/bin/pip install --quiet --target=/tmp/mcp-deps mcp 2>/dev/null; PYTHONPATH=/tmp/mcp-deps exec ${pythonRuntimeEnv}/bin/python3 -u /opt/agentbox/skills/imagemagick/mcp-server/server.py"
directory=/opt/agentbox/skills/imagemagick/mcp-server
environment=HOME="/workspace"
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
environment=HOME="/workspace",RUST_LOG="info",AGENTBOX_REQUIRED_FOR_READINESS="false"
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
environment=HOME="/workspace",HF_HOME="/workspace/.cache/huggingface",TRANSFORMERS_CACHE="/workspace/.cache/huggingface",OPF_PORT="${toString (privacyFilterCfg.port or 9092)}",OPF_MODE="${privacyFilterCfg.mode or "off"}",OPF_DTYPE="${privacyFilterCfg.dtype or "bf16"}",OPF_MODEL="${privacyFilterCfg.model or "openai/privacy-filter"}"
autostart=true
autorestart=true
priority=240
stdout_logfile=/var/log/opf-router.log
stderr_logfile=/var/log/opf-router.error.log
''}
${lib.optionalString (mediaCfg.comfyui_builtin or false) ''

[program:comfyui-builtin]
command=${comfyuiPythonEnv}/bin/python3 ${comfyuiSrc}/main.py --listen 127.0.0.1 --port 8188
directory=${comfyuiSrc}
environment=HOME="/workspace",COMFYUI_OUTPUT_DIR="/workspace/comfyui-outputs"
autostart=true
autorestart=true
priority=220
stdout_logfile=/var/log/comfyui-builtin.log
stderr_logfile=/var/log/comfyui-builtin.error.log
''}
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
        integrationsCfg = agentboxConfig.integrations or {};
        ragflowCfg      = integrationsCfg.ragflow           or {};
        ruvectorExtCfg  = integrationsCfg.ruvector_external or {};
        comfyuiExtCfg   = integrationsCfg.comfyui_external  or {};
        observCfg       = agentboxConfig.observability or {};
        adaptersCfg     = agentboxConfig.adapters     or {};

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

        # Ollama service block – only emitted when gpuEnabled.
        ollamaServiceBlock = lib.optionalString gpuEnabled ''
  ollama:
    image: ollama/ollama:latest
    container_name: ollama
    restart: unless-stopped
${if gpuRuntime == "rocm" then rocmDevices
  else if gpuRuntime == "nvidia" then "    runtime: nvidia"
  else ""}
    ports:
      - "11434:11434"
    volumes:
      - ollama:/root/.ollama
    environment:
      - OLLAMA_HOST=0.0.0.0:11434
${lib.optionalString (gpuRuntime == "nvidia") ''      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=compute,utility''}      - OLLAMA_VULKAN=${if gpuRuntime == "rocm" then "1" else "0"}
      - OLLAMA_FLASH_ATTENTION=true
      - OLLAMA_KV_CACHE_TYPE=q8_0
      - OLLAMA_CONTEXT_LENGTH=8192
'';

        # Ports for the agentbox service.
        # Always: management-api (9090), ruvector (9700), metrics (observCfg.metrics_port)
        # Sovereign: solid-pod (8484)
        # Desktop:  VNC (5901)
        # Jupyter:  8888
        # code_server: 8080
        metricsPort = toString (observCfg.metrics_port or 9091);

        agentboxPorts =
          ''      - "9090:9090"''
          + "\n      - \"9700:9700\""
          + "\n      - \"${metricsPort}:${metricsPort}\""
          + lib.optionalString (sovereignCfg.enabled or false)
              "\n      - \"8484:8484\""
          + lib.optionalString (relayEnabled && (relayCfg.expose or false))
              ("\n      - \"" + toString (relayCfg.port or 7777) + ":" + toString (relayCfg.port or 7777) + "\"")
          + lib.optionalString (dataScienceCfg.jupyter or false)
              "\n      - \"8888:8888\""
          + lib.optionalString (desktopCfg.enabled or false)
              "\n      - \"5901:5901\""
          + lib.optionalString ((toolchainCfg.code_server or false))
              "\n      - \"8080:8080\"";

        # agentbox depends_on block.
        agentboxDependsOn = lib.optionalString gpuEnabled ''
    depends_on:
      ollama:
        condition: service_started'';

        # External network declaration for ragflow integration.
        ragflowNetworkDecl = lib.optionalString (ragflowCfg.enabled or false) ''
  docker_ragflow:
    external: true'';

        # agentbox network attachment block.
        agentboxNetworks = lib.optionalString (ragflowCfg.enabled or false) ''
    networks:
      - default
      - docker_ragflow'';

        # Extra hosts that let containers reach the Docker host.
        agentboxExtraHosts = ''
    extra_hosts:
      - "host.docker.internal:host-gateway"'';

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
            )
            securityExceptions;

        exceptionTmpfsPaths     = lib.concatMap (exc: exc.tmpfs or [])           (lib.attrValues activeExceptions);
        exceptionDevicePaths    = lib.concatMap (exc: exc.devices or [])         (lib.attrValues activeExceptions);
        exceptionCapAdd         = lib.concatMap (exc: exc.cap_add or [])         (lib.attrValues activeExceptions);
        exceptionWritableVolumes= lib.concatMap (exc: exc.writable_volumes or []) (lib.attrValues activeExceptions);

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
        baselineTmpfsMounts = [
          "/tmp:mode=1777,size=256M"
          "/run:mode=755,size=64M"
          "/var/run:mode=755,size=16M"
          "/var/log:mode=755,size=128M"
          "/var/log/supervisor:mode=755,size=64M"
        ];
        mergedTmpfsMounts   = lib.unique (baselineTmpfsMounts ++ exceptionTmpfsPaths);

        agentboxTmpfs =
          lib.concatMapStrings (p: "      - ${p}\n") mergedTmpfsMounts;

        agentboxDevices =
          lib.optionalString (exceptionDevicePaths != []) (
            "    devices:\n"
            + lib.concatMapStrings (d: "      - ${d}\n") exceptionDevicePaths
          );

        agentboxCapabilities =
          "    cap_drop:\n      - ALL"
          + lib.optionalString (exceptionCapAdd != []) (
              "\n    cap_add:\n"
              + lib.concatMapStrings (c: "      - ${c}\n") exceptionCapAdd
            );

        agentboxRuntime =
          lib.optionalString (exceptionRuntime != null) "    runtime: ${exceptionRuntime}\n";

        # Volumes list for agentbox service.
        agentboxVolumes =
          ''      - ./agentbox.toml:/etc/agentbox.toml:ro''
          + "\n      - ./workspace:/workspace"
          + "\n      - ./projects:/projects"
          + "\n      - ruvector-data:/var/lib/ruvector"
          + "\n      - solid-data:/var/lib/solid"
          + "\n      - sovereign-identities:/var/lib/agentbox/identities"
          + lib.concatMapStrings (v: "\n      - ${v}") exceptionWritableVolumes;

        # Top-level volumes block.
        topLevelVolumes =
          lib.optionalString gpuEnabled "  ollama:\n    name: ollama\n"
          + ''  ruvector-data:
    name: agentbox-ruvector-data
  solid-data:
    name: agentbox-solid-data
  sovereign-identities:
    name: agentbox-sovereign-identities''
          + lib.optionalString relayLocal ''

  nostr-relay-data:
    name: agentbox-nostr-relay-data'';

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
      - OPENAI_BASE_URL=''${OPENAI_BASE_URL:-http://host.docker.internal:11434/v1}
      - OLLAMA_BASE_URL=''${OLLAMA_BASE_URL:-http://host.docker.internal:11434}
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
    user: "1000:1000"
    read_only: true
${agentboxRuntime}${agentboxCapabilities}
${agentboxDevices}    tmpfs:
${agentboxTmpfs}    security_opt:
      - no-new-privileges:true
      - seccomp=default
    volumes:
${agentboxVolumes}
${agentboxNetworks}

volumes:
${topLevelVolumes}
${lib.optionalString (ragflowCfg.enabled or false) ''
networks:
${ragflowNetworkDecl}
''}        '';

        configFiles = pkgs.runCommand "agentbox-config" {} ''
          mkdir -p $out/etc/agentbox
          cp ${pkgs.writeText "supervisord.conf" supervisorText} $out/etc/supervisord.conf
          cp ${./agentbox.toml} $out/etc/agentbox.toml
          cp ${pkgs.writeText "docker-compose.yml" composeText} $out/etc/agentbox/docker-compose.yml
          ${lib.optionalString relayLocal ''
          cp ${pkgs.writeText "nostr-relay.toml" relayConfigText} $out/etc/agentbox/nostr-relay.toml
          ''}
        '';

        entrypoint = pkgs.writeShellScriptBin "entrypoint" ''
          # nix2container images lack FHS paths; create /usr/bin/env
          # for shebangs in npm wrapper scripts (buildNpmPackage outputs)
          mkdir -p /usr/bin 2>/dev/null || true
          ln -sf ${pkgs.coreutils}/bin/env /usr/bin/env 2>/dev/null || true

          exec ${pkgs.bash}/bin/bash /opt/agentbox/config/entrypoint-unified.sh
        '';

        imageEnv = [
          "PATH=/bin:/usr/bin:${pkgs.lib.makeBinPath allPackages}"
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
          "SOLID_REQUIRE_NIP98=${boolEnv (sovereignCfg.enabled or false)}"
          "NOSTR_BRIDGE_ENABLED=${boolEnv (sovereignCfg.nostr_bridge or false)}"
          "NOSTR_BRIDGE_PORT=9740"
          "NOSTR_RELAYS=wss://relay.damus.io,wss://relay.primal.net"
          "XKB_CONFIG_ROOT=${pkgs.xkeyboard_config}/share/X11/xkb"
          "ENABLE_DESKTOP=${boolEnv (desktopCfg.enabled or false)}"
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
          "ENABLE_CLAUDE=${boolEnv (toolchainCfg.claude or false)}"
          "ENABLE_RUFLO=${boolEnv (toolchainCfg.ruflo or false)}"
          "ENABLE_CLAUDE_FLOW=${boolEnv (toolchainCfg.claude_flow or false)}"
          "ENABLE_AGENTIC_QE=${boolEnv (toolchainCfg.agentic_qe or false)}"
          "ENABLE_NAGUAL_QE=${boolEnv (toolchainCfg.nagual_qe or false)}"
          "ENABLE_CODEBASE_MEMORY=${boolEnv (toolchainCfg.codebase_memory or false)}"
          "ENABLE_RUST_TOOLCHAIN=${boolEnv (toolchainCfg.rust or false)}"
          "ENABLE_GEMINI_CLI=${boolEnv (toolchainCfg.gemini_cli or false)}"
          "ENABLE_CODEX=${boolEnv (toolchainCfg.codex or false)}"
          "WORKSPACE=/workspace"
          "SHARED_PROJECTS_ROOT=/projects"
          "AGENTBOX_AGENT_ID=agentbox-core"
          "CLAUDE_CONFIG_DIR=/workspace/.claude"
          "SKILLS_TREE=/opt/agentbox/skills"
          "GPU_BACKEND=${agentboxConfig.gpu.backend or "none"}"
          # Privacy filter (ADR-008) — non-empty OPF_ENABLED signals the
          # adapter middleware to route through the opf-router sidecar.
          "OPF_ENABLED=${boolEnv privacyFilterEnabled}"
          "OPF_PORT=${toString (privacyFilterCfg.port or 9092)}"
          "OPF_MODE=${privacyFilterCfg.mode or "off"}"
          "OPF_POLICY_PODS=${(privacyFilterCfg.policy or {}).pods or "strict"}"
          "OPF_POLICY_MEMORY=${(privacyFilterCfg.policy or {}).memory or "strict"}"
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

        mkImage = { tag, extraPackages ? [], maxLayers ? 100 }:
          n2c.buildImage {
            name = "agentbox";
            inherit tag maxLayers;
            layers = [
              (n2c.buildLayer { deps = basePackages; })
              (n2c.buildLayer { deps = nodeEnvPackages ++ pythonBasePackages; })
              (n2c.buildLayer { deps = [ rustToolchain ] ++ wasmPackages ++ dbPackages; })
              (n2c.buildLayer { deps = mediaPackages ++ browserPackages ++ spatialPackages ++ dataSciencePackages ++ docsPackages ++ desktopPackages ++ extraPackages; })
            ];
            copyToRoot = pkgs.buildEnv {
              name = "agentbox-root";
              paths = [ entrypoint configFiles appRoot ];
              pathsToLink = [ "/bin" "/etc" "/opt" ];
            };
            config = {
              Entrypoint = [ "${entrypoint}/bin/entrypoint" ];
              Env = imageEnv;
              WorkingDir = "/workspace";
              ExposedPorts = commonPorts // sovereignPorts // desktopPorts // dataSciencePorts;
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
