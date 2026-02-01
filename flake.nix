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
        ];

        # Node.js runtime
        nodePackages = with pkgs; [
          nodejs_20
          nodePackages.npm
          nodePackages.pnpm
        ];

        # Python runtime
        pythonPackages = with pkgs; [
          python312
          python312Packages.pip
          python312Packages.virtualenv
          python312Packages.setuptools
        ];

        # Rust toolchain (minimal, no GPU)
        rustToolchain = pkgs.rust-bin.stable.latest.minimal.override {
          extensions = [ "rust-src" "clippy" "rustfmt" ];
        };

        # PostgreSQL client (for RuVector connection)
        dbPackages = with pkgs; [
          postgresql_16
        ];

        # Media processing (CLI only)
        mediaPackages = with pkgs; [
          ffmpeg
          imagemagick
        ];

        # Browser automation (headless)
        browserPackages = with pkgs; [
          chromium
          playwright-driver
        ];

        # Process management
        servicePackages = with pkgs; [
          supervisor
          procps
        ];

        # Minimal VNC/X11 for remote desktop via SSH tunnel
        # Lightweight: ~150MB total, no full DE
        vncPackages = with pkgs; [
          xorg.xorgserver     # Xvfb virtual framebuffer
          x11vnc              # VNC server
          openbox             # Minimal window manager (~2MB)
          xterm               # Basic terminal
          xorg.xauth
          xorg.xinit
          xorg.xset
          # Optional lightweight apps
          pcmanfm             # File manager
          feh                 # Image viewer
        ];

        # All packages combined
        allPackages = basePackages
          ++ nodePackages
          ++ pythonPackages
          ++ [ rustToolchain ]
          ++ dbPackages
          ++ mediaPackages
          ++ browserPackages
          ++ servicePackages;

        # Create entrypoint script
        entrypoint = pkgs.writeShellScriptBin "entrypoint" ''
          #!${pkgs.bash}/bin/bash
          set -e

          echo "=== Agentbox Container Starting ==="
          echo "Architecture: $(uname -m)"
          echo "Node.js: $(node --version)"
          echo "Python: $(python3 --version)"
          echo "Rust: $(rustc --version)"

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

            # Layer 5: Database client (~50MB)
            (n2c.buildLayer {
              deps = dbPackages;
            })

            # Layer 6: Media tools (~50MB)
            (n2c.buildLayer {
              deps = mediaPackages;
            })

            # Layer 7: Services (~20MB)
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
            ];
            WorkingDir = "/workspace";
            ExposedPorts = {
              "22/tcp" = {};    # SSH
              "8080/tcp" = {};  # code-server
              "9090/tcp" = {};  # Management API
              "9600/tcp" = {};  # Z.AI (internal)
            };
            Labels = {
              "org.opencontainers.image.title" = "Agentbox";
              "org.opencontainers.image.description" = "Minimal agentic container for Claude Flow V3";
              "org.opencontainers.image.source" = "https://github.com/DreamLab-AI/agentbox";
              "org.opencontainers.image.version" = "1.0.0";
              "org.opencontainers.image.architecture" = system;
            };
          };
        };

        # PostgreSQL image - RuVector memory store
        postgresImage = n2c.buildImage {
          name = "agentbox";
          tag = "postgres-${system}";

          layers = [
            (n2c.buildLayer {
              deps = with pkgs; [
                coreutils
                bash
                postgresql_16
                cacert
              ];
            })
          ];

          config = {
            Entrypoint = [ "${pkgs.postgresql_16}/bin/postgres" ];
            Env = [
              "PGDATA=/var/lib/postgresql/data"
              "POSTGRES_USER=ruvector"
              "POSTGRES_DB=ruvector"
            ];
            ExposedPorts = {
              "5432/tcp" = {};
            };
            Volumes = {
              "/var/lib/postgresql/data" = {};
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
            ];
            WorkingDir = "/workspace";
            ExposedPorts = {
              "22/tcp" = {};
              "5432/tcp" = {};
              "8080/tcp" = {};
              "9090/tcp" = {};
              "9600/tcp" = {};
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
            ];
            WorkingDir = "/workspace";
            ExposedPorts = {
              "22/tcp" = {};     # SSH (tunnel VNC through this)
              "5901/tcp" = {};   # VNC (localhost only via SSH tunnel)
              "8080/tcp" = {};   # code-server
              "9090/tcp" = {};   # Management API
              "9600/tcp" = {};   # Z.AI (internal)
            };
            Labels = {
              "org.opencontainers.image.title" = "Agentbox Desktop";
              "org.opencontainers.image.description" = "Minimal agentic container with VNC desktop via SSH tunnel";
              "org.opencontainers.image.source" = "https://github.com/DreamLab-AI/agentbox";
              "org.opencontainers.image.version" = "1.0.0";
              "org.opencontainers.image.architecture" = system;
            };
          };
        };

      in {
        packages = {
          runtime = runtimeImage;
          postgres = postgresImage;
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
            echo "  nix build .#postgres - Build postgres image"
            echo "  nix build .#full     - Build full image"
            echo ""
          '';
        };
      });
}
