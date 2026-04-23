# lib/gpu-backend.nix
#
# Central GPU backend dispatch table.
#
# Usage (from flake.nix or the compose generator):
#
#   gpuCfg = (import ./lib/gpu-backend.nix { inherit lib pkgs; })
#              .dispatchGpuBackend (agentboxConfig.gpu.backend or "none");
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
    # ----------------------------------------------------------------
    "local-cuda" = {
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
      nixPackages = with pkgs; [
        # CUDA 12.x toolchain available in nixos-unstable as cudaPackages
        cudaPackages.cudatoolkit
        cudaPackages.cuda_nvcc
        cudaPackages.libcublas
        cudaPackages.libcufft
        cudaPackages.libcurand
      ];
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
  # dispatchGpuBackend :: string -> attrset
  #
  # Returns the canonical GPU backend descriptor for the given enum value.
  # Throws a descriptive error on unrecognised values so manifest mistakes
  # surface at eval time rather than silently producing a broken image.
  dispatchGpuBackend = backend:
    backends.${backend} or (
      throw "agentbox: [gpu].backend \"${backend}\" is not recognised. "
          + "Valid values: none, ollama-rocm, ollama-cuda, local-cuda."
    );
}
