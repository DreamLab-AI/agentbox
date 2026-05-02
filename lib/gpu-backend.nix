# lib/gpu-backend.nix
#
# Central GPU backend dispatch table.
#
# Usage (from flake.nix or the compose generator):
#
#   gpuCfg = (import ./lib/gpu-backend.nix { inherit lib pkgs; })
#              .dispatchGpuBackend
#                (agentboxConfig.gpu.backend or "none")
#                (agentboxConfig.toolchains.cuda or false);
#
# The returned attrset has a stable shape regardless of which branch is
# selected.  Consumers must handle null values (e.g. composeDeviceReservations
# is null for non-CUDA paths).
#
# Key contract (agreed with the A1 compose-generator agent):
#
#   devicesNeeded              – list of "/dev/foo:/dev/foo" strings
#   runtimeClass               – string; "" means default OCI runtime
#   envVars                    – attrset of NAME = "value" env vars for the
#                                ollama container
#   nixPackages                – list of Nix derivations to add to the image
#   composeDeviceReservations  – attrset or null; maps to compose
#                                deploy.resources.reservations.devices
#   supervisorExtraEnv         – attrset of NAME = "value" injected into
#                                supervisord [program:*] environment stanzas
#                                that need GPU access (e.g. comfyui, blender)
#   ollamaEnabled              – bool; false means the A1 generator must omit
#                                the ollama service entirely from compose

{ lib, pkgs }:

let
  # ------------------------------------------------------------------
  # Helpers
  # ------------------------------------------------------------------

  # Null / empty defaults for branches that don't use a field.
  noDevices       = [];
  noRuntime       = "";
  noEnv           = {};
  noPackages      = [];
  noReservations  = null;
  noSupervisorEnv = {};

  # ------------------------------------------------------------------
  # Branch definitions
  # ------------------------------------------------------------------

  backends = {

    # ----------------------------------------------------------------
    # none — no GPU; ollama sidecar is omitted from compose
    # ----------------------------------------------------------------
    none = {
      devicesNeeded             = noDevices;
      runtimeClass              = noRuntime;
      envVars                   = noEnv;
      nixPackages               = noPackages;
      composeDeviceReservations = noReservations;
      supervisorExtraEnv        = noSupervisorEnv;
      ollamaEnabled             = false;
    };

    # ----------------------------------------------------------------
    # ollama-rocm — ROCm/Vulkan via /dev/kfd + /dev/dri
    # Ollama sidecar is included; host provides ROCm drivers.
    # No extra Nix packages are needed — ROCm lives in the sidecar image.
    # ----------------------------------------------------------------
    "ollama-rocm" = {
      devicesNeeded = [
        "/dev/kfd:/dev/kfd"
        "/dev/dri:/dev/dri"
      ];
      runtimeClass              = noRuntime;
      envVars                   = {
        OLLAMA_VULKAN           = "1";
        OLLAMA_FLASH_ATTENTION  = "true";
        OLLAMA_KV_CACHE_TYPE    = "q8_0";
        OLLAMA_CONTEXT_LENGTH   = "8192";
        OLLAMA_HOST             = "0.0.0.0:11434";
      };
      nixPackages               = noPackages;
      composeDeviceReservations = noReservations;
      supervisorExtraEnv        = noSupervisorEnv;
      ollamaEnabled             = true;
    };

    # ----------------------------------------------------------------
    # ollama-cuda — NVIDIA CUDA via the nvidia container runtime.
    # Uses deploy.resources.reservations.devices in compose (compose v3
    # preferred form over legacy `runtime: nvidia`).
    # No CUDA packages in the Nix image — inference lives in the sidecar.
    # ----------------------------------------------------------------
    "ollama-cuda" = {
      devicesNeeded             = noDevices;      # handled by reservations
      runtimeClass              = "nvidia";
      envVars                   = {
        NVIDIA_VISIBLE_DEVICES  = "all";
        NVIDIA_DRIVER_CAPABILITIES = "compute,utility";
        OLLAMA_FLASH_ATTENTION  = "true";
        OLLAMA_KV_CACHE_TYPE    = "q8_0";
        OLLAMA_CONTEXT_LENGTH   = "8192";
        OLLAMA_HOST             = "0.0.0.0:11434";
      };
      nixPackages               = noPackages;
      composeDeviceReservations = {
        driver       = "nvidia";
        count        = "all";
        capabilities = [ "gpu" ];
      };
      supervisorExtraEnv = noSupervisorEnv;
      ollamaEnabled      = true;
    };

    # ----------------------------------------------------------------
    # local-cuda — CUDA toolchain baked into the Nix image.
    # Enables gaussian_splatting and direct CUDA workloads inside the
    # agentbox container.  The ollama sidecar also gets CUDA access.
    #
    # Base packages: CUDA 12.x from the default cudaPackages alias in
    # nixos-unstable (currently tracks 12.x; updated as nixpkgs advances).
    #
    # [toolchains].cuda = true augments this with the full CUDA 13.1
    # toolchain (cudaPackages_13_1).  If cudaPackages_13_1 is not yet
    # available in the pinned nixpkgs rev, fall back to cudaPackages and
    # leave a comment — the attribute set is guarded by lib.optionals so
    # an evaluation error surfaces immediately rather than silently omitting
    # packages.
    #
    # NOTE: aarch64 does not support CUDA; the extended package list is
    # wrapped in lib.optionals stdenv.isx86_64 so cross-arch builds remain
    # clean.
    # ----------------------------------------------------------------
    "local-cuda" = { toolchainsCudaEnabled ? false }:
    let
      # CUDA is Linux-only; guard against darwin eval even though darwin
      # x86_64 satisfies stdenv.isx86_64, it never has cudaPackages available.
      cudaEligible = pkgs.stdenv.isLinux && pkgs.stdenv.isx86_64;
      # cudaPackages_13_0 has a nixpkgs packaging bug (missing math_functions.h
      # in cuda_nvcc postInstall substitute). Skip it; 13.1+ or 12.x are fine.
      extendedCudaSet =
        if pkgs ? cudaPackages_13_1 then pkgs.cudaPackages_13_1
        else if pkgs ? cudaPackages_12_6 then pkgs.cudaPackages_12_6
        else if pkgs ? cudaPackages_12_1 then pkgs.cudaPackages_12_1
        else pkgs.cudaPackages;

      # Base CUDA 12.x packages — always included when backend=local-cuda
      # AND the platform is Linux-x86_64. On any other platform the list
      # is empty and the user gets a degraded "GPU backend declared but
      # CUDA unavailable" setup; the validator still gates harder use.
      baseCudaPackages = lib.optionals cudaEligible (with pkgs; [
        cudaPackages.cudatoolkit
        cudaPackages.cuda_nvcc
        cudaPackages.libcublas
        cudaPackages.libcufft
        cudaPackages.libcurand
      ]);

      # Extended CUDA packages — only when [toolchains].cuda = true.
      # Pick the newest available CUDA package set from the pinned nixpkgs
      # rather than hardcoding a minor namespace.
      extendedCudaPackages = lib.optionals (toolchainsCudaEnabled && cudaEligible) (
        [ extendedCudaSet.cudatoolkit ]
        ++ lib.optionals (extendedCudaSet ? cudnn) [ extendedCudaSet.cudnn ]
        ++ lib.optionals (extendedCudaSet ? cutensor) [ extendedCudaSet.cutensor ]
        ++ lib.optionals (extendedCudaSet ? libcublas) [ extendedCudaSet.libcublas ]
        ++ lib.optionals (extendedCudaSet ? libcufft) [ extendedCudaSet.libcufft ]
      );
    in
    {
      devicesNeeded = noDevices;                 # handled by reservations
      runtimeClass  = "nvidia";
      envVars = {
        NVIDIA_VISIBLE_DEVICES     = "all";
        NVIDIA_DRIVER_CAPABILITIES = "compute,utility";
        OLLAMA_FLASH_ATTENTION     = "true";
        OLLAMA_KV_CACHE_TYPE       = "q8_0";
        OLLAMA_CONTEXT_LENGTH      = "8192";
        OLLAMA_HOST                = "0.0.0.0:11434";
      };
      nixPackages = baseCudaPackages ++ extendedCudaPackages;
      composeDeviceReservations = {
        driver       = "nvidia";
        count        = "all";
        capabilities = [ "gpu" "compute" "utility" ];
      };
      supervisorExtraEnv = {
        CUDA_VISIBLE_DEVICES        = "all";
        NVIDIA_DRIVER_CAPABILITIES  = "compute,utility";
      };
      ollamaEnabled = true;
    };
  };

in
{
  # dispatchGpuBackend :: string -> bool -> attrset
  #
  # Returns the canonical GPU backend descriptor for the given enum value.
  # toolchainsCudaEnabled corresponds to [toolchains].cuda in agentbox.toml.
  # Throws a descriptive error on unrecognised values so manifest mistakes
  # surface at eval time rather than silently producing a broken image.
  dispatchGpuBackend = backend: toolchainsCudaEnabled:
    let
      resolved =
        if backend == "local-cuda"
        then backends."local-cuda" { inherit toolchainsCudaEnabled; }
        else backends.${backend} or (
          throw "agentbox: [gpu].backend \"${backend}\" is not recognised. "
              + "Valid values: none, ollama-rocm, ollama-cuda, local-cuda."
        );
    in
    # Enforce the cross-constraint at Nix eval time: toolchains.cuda=true
    # requires gpu.backend="local-cuda" (mirrors validator rule E019).
    if toolchainsCudaEnabled && backend != "local-cuda"
    then throw "agentbox: [toolchains].cuda=true requires [gpu].backend=\"local-cuda\" (E019)"
    else resolved;
}
