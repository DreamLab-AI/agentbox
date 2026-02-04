{
  description = "Agentbox - Minimal Agentic Container for ARM64 and x86_64";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    nix2container.url = "github:nlewo/nix2container";
    rust-overlay.url = "github:oxalica/rust-overlay";
  };

  outputs = { self, nixpkgs, flake-utils, nix2container, rust-overlay }:
    flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" ] (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ rust-overlay.overlays.default ];
          config.allowUnfree = true;
        };

        n2c = nix2container.packages.${system}.nix2container;

        # Common packages for all images
        basePackages = with pkgs; [
          # Core utilities
          coreutils
          bash
          zsh
          gnugrep
          gnused
          gawk
          findutils
          which
          less
          file

          # Network utilities
          curl
          wget
          cacert
          openssh

          # Development tools
          git
          jq
          ripgrep
          fd
          bat
          tree
          tmux
          vim
          nano

          # Build essentials
          gnumake
          gcc
          pkg-config

          # Additional utilities for skills
          unzip
          zip
          gzip
          xz
          htop
          ncdu

          # Git utilities
          gh  # GitHub CLI for github-* skills
          git-lfs

          # Text processing
          pandoc  # For docs-alignment skill

          # Cloud CLIs (skills: github-*, cloud deployments)
          google-cloud-sdk  # gcloud, gsutil, bq commands
        ];

        # Node.js runtime with skills dependencies
        nodePackages = with pkgs; [
          nodejs_20
          nodePackages.npm
          nodePackages.pnpm
          nodePackages.yarn
          nodePackages.typescript
          nodePackages.typescript-language-server

          # Build tools for skills
          nodePackages.esbuild
          nodePackages.prettier
        ];

        # Python runtime with skills dependencies
        pythonPackages = with pkgs; [
          python312
          python312Packages.pip
          python312Packages.virtualenv
          python312Packages.setuptools
          python312Packages.wheel

          # HTTP & Networking (skills: web-summary, perplexity-research, host-webserver-debug)
          python312Packages.requests
          python312Packages.httpx
          python312Packages.aiohttp
          python312Packages.aiofiles
          python312Packages.urllib3
          python312Packages.websockets

          # Data Processing (skills: jupyter-notebooks, pytorch-ml)
          python312Packages.pandas
          python312Packages.numpy
          python312Packages.pydantic

          # Jupyter (skills: jupyter-notebooks)
          python312Packages.jupyter
          python312Packages.jupyterlab
          python312Packages.notebook
          python312Packages.ipykernel
          python312Packages.nbformat

          # CLI & Output (skills: build-with-quality, verification-quality)
          python312Packages.rich
          python312Packages.tabulate
          python312Packages.colorama

          # Parsing & Templating (skills: docs-alignment, latex-documents)
          python312Packages.pyyaml
          python312Packages.jinja2
          python312Packages.markdown
          python312Packages.beautifulsoup4
          python312Packages.lxml
          python312Packages.jsonschema
          python312Packages.chardet

          # Git & Docker (skills: github-*, docker-manager)
          python312Packages.gitpython
          python312Packages.docker

          # AI/ML SDKs (skills: build-with-quality, reasoningbank-*)
          python312Packages.anthropic
          python312Packages.tiktoken

          # Web Scraping (skills: web-summary)
          python312Packages.youtube-transcript-api

          # Validation
          python312Packages.validators

          # Browser Automation (skills: playwright, host-webserver-debug)
          python312Packages.playwright

          # Type Checking
          python312Packages.typing-extensions
          python312Packages.types-requests
        ];

        # Rust toolchain (minimal, no GPU) with WASM support
        rustToolchain = pkgs.rust-bin.stable.latest.minimal.override {
          extensions = [ "rust-src" "clippy" "rustfmt" ];
          targets = [ "wasm32-unknown-unknown" ];  # WASM target for wasm-js skill
        };

        # WASM tools (skills: wasm-js, rust-development)
        wasmPackages = with pkgs; [
          wasm-pack      # Rust to WASM build tool
          wasm-bindgen-cli
          binaryen       # WASM optimizer (wasm-opt)
        ];

        # Runtime packages (installed via npm at startup or on first use via npx):
        # Core:
        # - @claude-flow/cli@latest: V3 swarm orchestration
        # - ruvector: Standalone vector database with HNSW indexing
        # - @anthropic-ai/claude-code@latest: Claude Code CLI
        #
        # Browser Automation:
        # - agent-browser@latest: Vercel Labs AI-optimized browser (primary)
        # - @claude-flow/browser@latest: Claude Flow browser MCP
        #
        # Agentic Ecosystem:
        # - agentic-flow@latest: Multi-agent flow orchestration
        # - agentic-qe@latest: Testing framework (51 agents, 12 domains)
        # - agentic-jujutsu@latest: Quantum-resistant git operations
        #
        # Utilities:
        # - claude-usage-cli@latest: Usage tracking
        # - gemini-flow: Google Gemini integration
        # - agentdb@latest: Agent memory database
        #
        # These are auto-installed by skills-entrypoint.sh or on first use via npx

        # RuVector - Standalone vector database (NO PostgreSQL required)
        # Uses embedded redb storage with HNSW indexing
        # Run via: npx ruvector (npm package)
        # Features: 150x-12,500x faster search, GNN layers, self-learning
        dbPackages = with pkgs; [
          # SQLite for lightweight session/state storage
          sqlite
        ];

        # Media processing (CLI only)
        mediaPackages = with pkgs; [
          ffmpeg
          imagemagick
        ];

        # Browser automation (headless + visible via VNC)
        # agent-browser and playwright are installed via npm at runtime
        browserPackages = with pkgs; [
          chromium              # Primary browser
          playwright-driver    # Playwright browser binaries

          # Dependencies for browser automation
          at-spi2-atk          # Accessibility (for element refs)
          cups                 # Printing (browser dependency)
          mesa                 # OpenGL (software rendering)
          libdrm               # DRM (display rendering)
          alsa-lib             # Audio (browser dependency)
          nss                  # Network security
          nspr                 # Netscape portable runtime
        ];

        # Process management
        servicePackages = with pkgs; [
          supervisor
          procps
        ];

        # VNC/X11 stack for remote desktop and browser automation
        # Access: ssh -L 5901:localhost:5901 user@host, then vnc://localhost:5901
        # ~200MB total footprint
        vncPackages = with pkgs; [
          # X11 core
          xorg.xorgserver     # Xvfb virtual framebuffer
          xorg.xauth
          xorg.xinit
          xorg.xset
          xorg.xdpyinfo       # Display info (used by agent-browser)
          xorg.xprop          # Window properties
          xorg.xwininfo       # Window info
          xorg.setxkbmap      # Keyboard layout
          xkeyboard_config    # Keyboard config data

          # VNC server
          x11vnc              # VNC server (lightweight)

          # Window manager (minimal)
          openbox             # Minimal WM (~2MB)
          tint2               # Taskbar/panel

          # Terminals
          xterm               # Basic terminal
          xfce.xfce4-terminal # Better terminal with tabs

          # Fonts (required for browser rendering)
          dejavu_fonts
          liberation_ttf
          noto-fonts
          fontconfig

          # Utilities
          xdotool             # X11 automation (click, type, etc.)
          xclip               # Clipboard
          scrot               # Screenshots
          feh                 # Image viewer
          pcmanfm             # File manager
        ];

        # All packages combined
        allPackages = basePackages
          ++ nodePackages
          ++ pythonPackages
          ++ [ rustToolchain ]
          ++ wasmPackages
          ++ dbPackages
          ++ mediaPackages
          ++ browserPackages
          ++ servicePackages;

        # Create entrypoint script
        entrypoint = pkgs.writeShellScriptBin "entrypoint" ''
          #!${pkgs.bash}/bin/bash
          set -e

          echo "========================================"
          echo "  AGENTBOX - Minimal Agentic Container"
          echo "========================================"
          echo ""

          echo "[1/7] System Information"
          echo "Architecture: $(uname -m)"
          echo "Node.js: $(node --version)"
          echo "Python: $(python3 --version)"
          echo "Rust: $(rustc --version)"
          echo ""

          # Create required directories
          echo "[2/7] Setting up directories..."
          mkdir -p /home/devuser/{workspace,agents,.claude/skills,.config,.cache,logs}
          mkdir -p /var/lib/ruvector /var/log/supervisor /tmp/screenshots
          mkdir -p /run/user/1000 && chmod 700 /run/user/1000

          # Clone 610+ Claude subagents if not present
          echo "[3/7] Setting up Claude subagents..."
          AGENTS_DIR=/home/devuser/agents
          export AGENTS_DIR
          if [ ! -f "$AGENTS_DIR/doc-planner.md" ] && [ -d "$AGENTS_DIR" ]; then
            echo "Cloning 610+ Claude subagents..."
            cd "$AGENTS_DIR"
            ${pkgs.git}/bin/git clone --depth 1 https://github.com/ChrisRoyse/610ClaudeSubagents.git temp-agents 2>/dev/null || true
            if [ -d "temp-agents/agents" ]; then
              mv temp-agents/agents/*.md . 2>/dev/null || true
              rm -rf temp-agents
              echo "✓ $(ls -1 $AGENTS_DIR/*.md 2>/dev/null | wc -l) agent templates available"
            fi
          else
            echo "✓ Agent templates already present: $(ls -1 $AGENTS_DIR/*.md 2>/dev/null | wc -l) agents"
          fi

          # Initialize AISP if available
          echo "[4/7] Initializing AISP 5.1 Platinum..."
          if [ -f /opt/aisp/cli.js ]; then
            ln -sf /opt/aisp/cli.js /usr/local/bin/aisp 2>/dev/null || true
            echo "✓ AISP CLI available at /usr/local/bin/aisp"
          fi

          # Install runtime npm packages (first run only)
          echo "[5/7] Checking runtime packages..."
          if [ ! -f /home/devuser/.npm_packages_installed ]; then
            echo "Installing Claude Flow ecosystem (first run)..."
            npm install -g @claude-flow/cli@latest agent-browser@latest playwright 2>/dev/null || true
            npx playwright install chromium 2>/dev/null || true
            touch /home/devuser/.npm_packages_installed
            echo "✓ Runtime packages installed"
          else
            echo "✓ Runtime packages already installed"
          fi

          # Clean stale X lock files and set up VNC if packages present
          echo "[6/7] Setting up VNC/X11 environment..."
          rm -f /tmp/.X*-lock /tmp/.X11-unix/X* 2>/dev/null || true

          # Check if VNC packages are available (desktop image)
          if command -v Xvfb >/dev/null 2>&1; then
            echo "VNC stack detected - starting X11 services..."
            export DISPLAY=:1

            # Start Xvfb (4K virtual framebuffer)
            Xvfb :1 -screen 0 4096x4096x24 -ac +extension GLX +render -noreset &
            sleep 2

            # Start window manager
            if command -v openbox >/dev/null 2>&1; then
              DISPLAY=:1 openbox &
            fi

            # Start VNC server (localhost only - MUST use SSH tunnel)
            if command -v x11vnc >/dev/null 2>&1; then
              x11vnc -display :1 -rfbport 5901 -forever -shared -nopw -xkb -localhost &
              echo "✓ VNC server running on localhost:5901 (SSH tunnel required)"
            fi

            # Create browser start script
            cat > /home/devuser/start-browser.sh << 'BROWSERSCRIPT'
#!/bin/bash
export DISPLAY=:1
chromium --no-sandbox --remote-debugging-port=9222 \
  --user-data-dir=/home/devuser/.config/chromium-automation \
  --window-size=1920,1080 \
  --disable-gpu \
  --disable-software-rasterizer "$@" &
echo "Browser started with CDP on port 9222"
echo "Connect with: agent-browser open <url>"
BROWSERSCRIPT
            chmod +x /home/devuser/start-browser.sh
            echo "✓ Browser automation ready (run ~/start-browser.sh)"
          else
            echo "✓ Headless mode (no VNC packages)"
          fi

          # Final setup
          echo "[7/7] Finalizing..."
          cd /home/devuser/workspace

          echo ""
          echo "========================================"
          echo "  Agentbox Ready"
          echo "========================================"
          echo ""
          echo "Quick commands:"
          echo "  agent-browser --help                - AI browser automation"
          echo "  ~/start-browser.sh                  - Start visible browser (VNC)"
          echo "  npx @claude-flow/cli@latest --help  - Claude Flow V3"
          echo "  npx ruvector serve                  - Start RuVector"
          echo "  aisp validate <file>                - AISP validation"
          echo ""
          if command -v x11vnc >/dev/null 2>&1; then
            echo "VNC Access:"
            echo "  ssh -L 5901:localhost:5901 user@host"
            echo "  Then: vnc://localhost:5901"
            echo ""
          fi

          # Start supervisord if available
          if [ -f /etc/supervisord.conf ]; then
            exec ${pkgs.supervisor}/bin/supervisord -c /etc/supervisord.conf -n
          else
            # Fallback to shell
            exec ${pkgs.bash}/bin/bash
          fi
        '';

        # Runtime image - main agentic workload
        runtimeImage = n2c.buildImage {
          name = "agentbox";
          tag = "runtime-${system}";

          maxLayers = 100;

          layers = [
            # Layer 1: Base utilities (~50MB)
            (n2c.buildLayer {
              deps = basePackages;
            })

            # Layer 2: Node.js runtime (~100MB)
            (n2c.buildLayer {
              deps = nodePackages;
            })

            # Layer 3: Python runtime (~150MB)
            (n2c.buildLayer {
              deps = pythonPackages;
            })

            # Layer 4: Rust toolchain (~200MB)
            (n2c.buildLayer {
              deps = [ rustToolchain ];
            })

            # Layer 5: WASM tools (~30MB)
            (n2c.buildLayer {
              deps = wasmPackages;
            })

            # Layer 6: Database client (~10MB)
            (n2c.buildLayer {
              deps = dbPackages;
            })

            # Layer 7: Media tools (~50MB)
            (n2c.buildLayer {
              deps = mediaPackages;
            })

            # Layer 8: Services (~20MB)
            (n2c.buildLayer {
              deps = servicePackages;
            })
          ];

          copyToRoot = pkgs.buildEnv {
            name = "root";
            paths = [ entrypoint ];
            pathsToLink = [ "/bin" ];
          };

          config = {
            Entrypoint = [ "${entrypoint}/bin/entrypoint" ];
            Env = [
              "PATH=/bin:/usr/bin:${pkgs.lib.makeBinPath allPackages}"
              "NODE_ENV=production"
              "PYTHONDONTWRITEBYTECODE=1"
              "RUST_BACKTRACE=1"
              "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
              "NIX_SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
              # RuVector standalone configuration
              "RUVECTOR_DATA_DIR=/var/lib/ruvector"
              "RUVECTOR_PORT=9700"
              # Agent templates directory (610+ Claude subagents)
              "AGENTS_DIR=/home/devuser/agents"
              # Workspace
              "WORKSPACE=/home/devuser/workspace"
            ];
            WorkingDir = "/workspace";
            ExposedPorts = {
              "22/tcp" = {};    # SSH
              "8080/tcp" = {};  # code-server
              "9090/tcp" = {};  # Management API
              "9600/tcp" = {};  # Z.AI (internal)
              "9700/tcp" = {};  # RuVector API
            };
            Labels = {
              "org.opencontainers.image.title" = "Agentbox";
              "org.opencontainers.image.description" = "Minimal agentic container for Claude Flow V3 with RuVector";
              "org.opencontainers.image.source" = "https://github.com/DreamLab-AI/agentbox";
              "org.opencontainers.image.version" = "1.0.0";
              "org.opencontainers.image.architecture" = system;
            };
          };
        };

        # Full image - combined runtime + services
        fullImage = n2c.buildImage {
          name = "agentbox";
          tag = "full-${system}";

          maxLayers = 120;

          layers = [
            (n2c.buildLayer {
              deps = allPackages;
            })
          ];

          copyToRoot = pkgs.buildEnv {
            name = "root";
            paths = [ entrypoint ];
            pathsToLink = [ "/bin" ];
          };

          config = {
            Entrypoint = [ "${entrypoint}/bin/entrypoint" ];
            Env = [
              "PATH=/bin:/usr/bin:${pkgs.lib.makeBinPath allPackages}"
              "NODE_ENV=production"
              "PYTHONDONTWRITEBYTECODE=1"
              "RUST_BACKTRACE=1"
              "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
              "RUVECTOR_DATA_DIR=/var/lib/ruvector"
              "RUVECTOR_PORT=9700"
            ];
            WorkingDir = "/workspace";
            ExposedPorts = {
              "22/tcp" = {};
              "8080/tcp" = {};
              "9090/tcp" = {};
              "9600/tcp" = {};
              "9700/tcp" = {};  # RuVector API
            };
          };
        };

        # Desktop image - runtime + minimal VNC desktop via SSH tunnel
        # Access: ssh -L 5901:localhost:5901 user@host, then vnc://localhost:5901
        desktopImage = n2c.buildImage {
          name = "agentbox";
          tag = "desktop-${system}";

          maxLayers = 125;

          layers = [
            # Layer 1: Base + Node + Python
            (n2c.buildLayer {
              deps = basePackages ++ nodePackages ++ pythonPackages;
            })

            # Layer 2: Rust + DB + Media
            (n2c.buildLayer {
              deps = [ rustToolchain ] ++ dbPackages ++ mediaPackages;
            })

            # Layer 3: Browser automation
            (n2c.buildLayer {
              deps = browserPackages;
            })

            # Layer 4: Services
            (n2c.buildLayer {
              deps = servicePackages;
            })

            # Layer 5: VNC/X11 minimal desktop (~150MB)
            (n2c.buildLayer {
              deps = vncPackages;
            })
          ];

          copyToRoot = pkgs.buildEnv {
            name = "root";
            paths = [ entrypoint ];
            pathsToLink = [ "/bin" ];
          };

          config = {
            Entrypoint = [ "${entrypoint}/bin/entrypoint" ];
            Env = [
              "PATH=/bin:/usr/bin:${pkgs.lib.makeBinPath (allPackages ++ vncPackages)}"
              "NODE_ENV=production"
              "PYTHONDONTWRITEBYTECODE=1"
              "RUST_BACKTRACE=1"
              "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
              "DISPLAY=:1"
              "RUVECTOR_DATA_DIR=/var/lib/ruvector"
              "RUVECTOR_PORT=9700"
            ];
            WorkingDir = "/workspace";
            ExposedPorts = {
              "22/tcp" = {};     # SSH (tunnel all services through this)
              # VNC 5901 is localhost only - use SSH tunnel
              "8080/tcp" = {};   # code-server
              "9090/tcp" = {};   # Management API
              "9222/tcp" = {};   # Chrome DevTools Protocol (localhost via tunnel)
              "9600/tcp" = {};   # Z.AI (internal)
              "9700/tcp" = {};   # RuVector API
            };
            Labels = {
              "org.opencontainers.image.title" = "Agentbox Desktop";
              "org.opencontainers.image.description" = "Minimal agentic container with RuVector and VNC desktop (SSH tunnel required)";
              "org.opencontainers.image.source" = "https://github.com/DreamLab-AI/agentbox";
              "org.opencontainers.image.version" = "1.0.0";
              "org.opencontainers.image.architecture" = system;
            };
          };
        };

      in {
        packages = {
          runtime = runtimeImage;
          full = fullImage;
          desktop = desktopImage;
          default = runtimeImage;
        };

        # Development shell
        devShells.default = pkgs.mkShell {
          buildInputs = allPackages ++ [
            pkgs.nix
            n2c.nix2container
          ];

          shellHook = ''
            echo "Agentbox development environment"
            echo "Architecture: ${system}"
            echo ""
            echo "Build commands:"
            echo "  nix build .#runtime  - Build runtime image"
            echo "  nix build .#full     - Build full image"
            echo "  nix build .#desktop  - Build desktop image with VNC"
            echo ""
            echo "RuVector (standalone vector database):"
            echo "  npx ruvector serve   - Start RuVector server"
            echo "  npx ruvector --help  - Show all commands"
            echo ""
          '';
        };
      });
}
