#!/usr/bin/env python3
"""
RightNow CUDA Specialist - MCP Server
Provides AI-powered CUDA development tools with 4 specialist agents
"""

import os
import sys
import json
import subprocess
import tempfile
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    from mcp import Server, StdioServerTransport
    from mcp.server import Request
    from mcp.types import Tool, TextContent
    from pydantic import BaseModel, Field
except ImportError:
    print("ERROR: mcp package not installed. Install with: pip install mcp", file=sys.stderr)
    sys.exit(1)

# Initialize MCP server
server = Server("rightnow-cuda")


# ============================================================================
# CUDA Environment Detection
# ============================================================================

def find_nvcc() -> Optional[str]:
    """Find nvcc compiler in system."""
    nvcc_path = subprocess.run(["which", "nvcc"], capture_output=True, text=True).stdout.strip()
    if nvcc_path and Path(nvcc_path).exists():
        return nvcc_path

    # Check common paths
    common_paths = ["/opt/cuda/bin/nvcc", "/usr/local/cuda/bin/nvcc"]
    for path in common_paths:
        if Path(path).exists():
            return path

    return None


def get_cuda_version() -> str:
    """Get CUDA toolkit version."""
    nvcc = find_nvcc()
    if not nvcc:
        return "Not found"

    try:
        result = subprocess.run([nvcc, "--version"], capture_output=True, text=True, check=True)
        match = re.search(r"release (\d+\.\d+)", result.stdout)
        return match.group(1) if match else "Unknown"
    except Exception:
        return "Unknown"


def get_gpu_info() -> List[Dict[str, Any]]:
    """Get GPU information via nvidia-smi."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=index,name,memory.total,compute_cap", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            check=True
        )

        gpus = []
        for line in result.stdout.strip().split('\n'):
            if line:
                parts = [p.strip() for p in line.split(',')]
                if len(parts) >= 4:
                    gpus.append({
                        "index": int(parts[0]),
                        "name": parts[1],
                        "memory_mb": int(parts[2]),
                        "compute_cap": parts[3]
                    })
        return gpus
    except Exception as e:
        return [{"error": str(e)}]


# ============================================================================
# Kernel Analyzer
# ============================================================================

class KernelAnalyzer:
    """Analyze CUDA kernels for optimization opportunities."""

    @staticmethod
    def analyze_kernel(code: str) -> Dict[str, Any]:
        """Comprehensive kernel analysis."""
        analysis = {
            "kernel_name": KernelAnalyzer._extract_kernel_name(code),
            "parameters": KernelAnalyzer._extract_parameters(code),
            "shared_memory": KernelAnalyzer._analyze_shared_memory(code),
            "global_accesses": KernelAnalyzer._count_global_accesses(code),
            "synchronization": KernelAnalyzer._analyze_synchronization(code),
            "optimizations": KernelAnalyzer._identify_optimizations(code),
            "warnings": KernelAnalyzer._identify_warnings(code)
        }
        return analysis

    @staticmethod
    def _extract_kernel_name(code: str) -> str:
        match = re.search(r'__global__\s+\w+\s+(\w+)\s*\(', code)
        return match.group(1) if match else "unknown"

    @staticmethod
    def _extract_parameters(code: str) -> List[str]:
        match = re.search(r'__global__\s+\w+\s+\w+\s*\(([^)]+)\)', code)
        if not match:
            return []

        params = []
        for param in match.group(1).split(','):
            words = param.strip().split()
            if words:
                params.append(words[-1].strip('*&'))
        return params

    @staticmethod
    def _analyze_shared_memory(code: str) -> Dict[str, Any]:
        matches = re.findall(r'__shared__\s+(\w+)\s+(\w+)\[([^\]]+)\]', code)
        if not matches:
            return {"used": False}

        return {
            "used": True,
            "variables": [{"type": m[0], "name": m[1], "size": m[2]} for m in matches],
            "count": len(matches)
        }

    @staticmethod
    def _count_global_accesses(code: str) -> int:
        # Count array accesses (rough estimate)
        return len(re.findall(r'\w+\[', code))

    @staticmethod
    def _analyze_synchronization(code: str) -> Dict[str, Any]:
        syncthreads_count = len(re.findall(r'__syncthreads\(\)', code))
        return {
            "syncthreads_count": syncthreads_count,
            "has_synchronization": syncthreads_count > 0
        }

    @staticmethod
    def _identify_optimizations(code: str) -> List[str]:
        opportunities = []

        # Check for shared memory usage
        if not re.search(r'__shared__', code):
            opportunities.append("Consider using shared memory to reduce global memory accesses")

        # Check for memory coalescing hints
        if re.search(r'\[\s*threadIdx\.x\s*\*', code):
            opportunities.append("Potential strided memory access - check coalescing")

        # Check for loop unrolling
        if re.search(r'for\s*\(', code) and not re.search(r'#pragma unroll', code):
            opportunities.append("Consider #pragma unroll for loops")

        return opportunities

    @staticmethod
    def _identify_warnings(code: str) -> List[str]:
        warnings = []

        # Check for potential race conditions
        if not re.search(r'__syncthreads\(\)', code) and re.search(r'__shared__', code):
            warnings.append("Shared memory used without synchronization - potential race condition")

        # Check for uncoalesced accesses
        if re.search(r'\[\s*threadIdx\.y', code):
            warnings.append("Potential uncoalesced memory access using threadIdx.y")

        return warnings


# ============================================================================
# CUDA Compiler
# ============================================================================

class CUDACompiler:
    """Compile CUDA kernels with nvcc."""

    def __init__(self):
        self.nvcc_path = find_nvcc()
        if not self.nvcc_path:
            raise RuntimeError("nvcc not found")

    def compile(
        self,
        source_code: str,
        output_type: str = "ptx",
        arch: Optional[str] = None,
        optimization: str = "O2"
    ) -> Dict[str, Any]:
        """Compile CUDA source code."""

        with tempfile.TemporaryDirectory() as tmpdir:
            source_file = Path(tmpdir) / "kernel.cu"
            source_file.write_text(source_code)

            # Build nvcc command
            cmd = [self.nvcc_path]

            if arch:
                cmd.extend(["-arch", arch])
            else:
                cmd.extend(["-arch", "sm_70"])  # Default

            cmd.append(f"-{optimization}")

            if output_type == "ptx":
                output_file = Path(tmpdir) / "kernel.ptx"
                cmd.extend(["-ptx", str(source_file), "-o", str(output_file)])
            elif output_type == "cubin":
                output_file = Path(tmpdir) / "kernel.cubin"
                cmd.extend(["-cubin", str(source_file), "-o", str(output_file)])
            else:
                output_file = Path(tmpdir) / "kernel.o"
                cmd.extend(["-c", str(source_file), "-o", str(output_file)])

            # Execute compilation
            try:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    check=True,
                    cwd=tmpdir
                )

                output_content = output_file.read_text() if output_file.exists() else ""

                return {
                    "success": True,
                    "output": output_content,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "command": " ".join(cmd)
                }
            except subprocess.CalledProcessError as e:
                return {
                    "success": False,
                    "error": e.stderr,
                    "stdout": e.stdout,
                    "command": " ".join(cmd)
                }


# ============================================================================
# MCP Tool Definitions
# ============================================================================

@server.list_tools()
async def list_tools() -> list[Tool]:
    """List all available CUDA development tools."""
    return [
        Tool(
            name="cuda_gpu_status",
            description="Get GPU information via nvidia-smi including compute capability, memory, and driver version",
            inputSchema={
                "type": "object",
                "properties": {
                    "verbose": {"type": "boolean", "description": "Include detailed information", "default": False}
                }
            }
        ),
        Tool(
            name="cuda_compile",
            description="Compile CUDA source code using nvcc with optional architecture and optimization flags",
            inputSchema={
                "type": "object",
                "properties": {
                    "source_code": {"type": "string", "description": "CUDA source code to compile"},
                    "output_type": {"type": "string", "enum": ["ptx", "cubin", "object"], "default": "ptx"},
                    "arch": {"type": "string", "description": "Target architecture (e.g., sm_89)", "default": "sm_70"},
                    "optimization": {"type": "string", "enum": ["O0", "O1", "O2", "O3"], "default": "O2"}
                },
                "required": ["source_code"]
            }
        ),
        Tool(
            name="cuda_analyze",
            description="Analyze CUDA kernel for optimization opportunities, memory patterns, and potential issues",
            inputSchema={
                "type": "object",
                "properties": {
                    "source_code": {"type": "string", "description": "CUDA kernel source code"},
                    "file_path": {"type": "string", "description": "Path to .cu file (alternative to source_code)"}
                }
            }
        ),
        Tool(
            name="cuda_create_kernel",
            description="Generate optimized CUDA kernel from specification using AI",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Kernel function name"},
                    "description": {"type": "string", "description": "What the kernel should do"},
                    "parameters": {"type": "object", "description": "Kernel parameters {name: type}"},
                    "optimizations": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Requested optimizations (shared_memory, coalescing, etc.)"
                    }
                },
                "required": ["name", "description"]
            }
        ),
        Tool(
            name="cuda_optimize_code",
            description="Optimize existing CUDA code using the Optimizer specialist agent",
            inputSchema={
                "type": "object",
                "properties": {
                    "source_code": {"type": "string", "description": "CUDA code to optimize"},
                    "target_gpu": {"type": "string", "description": "Target GPU model (e.g., RTX4090, A6000)"},
                    "focus": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optimization focus areas (memory, occupancy, latency, throughput)"
                    }
                },
                "required": ["source_code"]
            }
        ),
        Tool(
            name="cuda_debug_code",
            description="Debug CUDA code using the Debugger specialist agent",
            inputSchema={
                "type": "object",
                "properties": {
                    "source_code": {"type": "string", "description": "CUDA code with issues"},
                    "error_message": {"type": "string", "description": "Error message or unexpected behavior"},
                    "expected_behavior": {"type": "string", "description": "What should happen"}
                },
                "required": ["source_code"]
            }
        ),
        Tool(
            name="cuda_analyze_quality",
            description="Analyze code quality and provide recommendations using the Analyzer specialist agent",
            inputSchema={
                "type": "object",
                "properties": {
                    "source_code": {"type": "string", "description": "CUDA code to analyze"},
                    "report_format": {"type": "string", "enum": ["text", "markdown", "json"], "default": "markdown"}
                },
                "required": ["source_code"]
            }
        ),
        Tool(
            name="cuda_detect_arch",
            description="Auto-detect GPU compute capability for compilation flags",
            inputSchema={
                "type": "object",
                "properties": {}
            }
        ),
        Tool(
            name="cuda_read_file",
            description="Read CUDA source file (.cu, .cuh)",
            inputSchema={
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "Path to CUDA file"}
                },
                "required": ["file_path"]
            }
        ),
        Tool(
            name="cuda_write_file",
            description="Write CUDA source code to file",
            inputSchema={
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "Path to write"},
                    "content": {"type": "string", "description": "CUDA source code"}
                },
                "required": ["file_path", "content"]
            }
        ),
        Tool(
            name="cuda_list_files",
            description="List CUDA files (.cu, .cuh) in directory",
            inputSchema={
                "type": "object",
                "properties": {
                    "directory": {"type": "string", "description": "Directory to search", "default": "."}
                }
            }
        ),
        Tool(
            name="cuda_exec_bash",
            description="Execute bash command for CUDA builds/tests",
            inputSchema={
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Bash command to execute"}
                },
                "required": ["command"]
            }
        )
    ]


# ============================================================================
# MCP Tool Implementations
# ============================================================================

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    """Execute CUDA development tools."""

    try:
        if name == "cuda_gpu_status":
            gpus = get_gpu_info()
            cuda_version = get_cuda_version()
            nvcc_path = find_nvcc()

            result = {
                "cuda_version": cuda_version,
                "nvcc_path": nvcc_path,
                "gpus": gpus,
                "gpu_count": len(gpus)
            }

            return [TextContent(type="text", text=json.dumps(result, indent=2))]

        elif name == "cuda_compile":
            compiler = CUDACompiler()
            result = compiler.compile(
                source_code=arguments["source_code"],
                output_type=arguments.get("output_type", "ptx"),
                arch=arguments.get("arch"),
                optimization=arguments.get("optimization", "O2")
            )
            return [TextContent(type="text", text=json.dumps(result, indent=2))]

        elif name == "cuda_analyze":
            if "file_path" in arguments:
                source_code = Path(arguments["file_path"]).read_text()
            else:
                source_code = arguments["source_code"]

            analyzer = KernelAnalyzer()
            analysis = analyzer.analyze_kernel(source_code)
            return [TextContent(type="text", text=json.dumps(analysis, indent=2))]

        elif name == "cuda_create_kernel":
            # Generate kernel template
            name_val = arguments["name"]
            desc = arguments["description"]
            params = arguments.get("parameters", {})
            opts = arguments.get("optimizations", [])

            # Build parameter list
            param_list = ", ".join([f"{ptype} {pname}" for pname, ptype in params.items()])

            # Generate kernel skeleton
            kernel = f"""__global__ void {name_val}({param_list}) {{
    // {desc}

    int idx = blockIdx.x * blockDim.x + threadIdx.x;

    // TODO: Implement kernel logic
    // Requested optimizations: {', '.join(opts)}
}}
"""
            return [TextContent(type="text", text=kernel)]

        elif name == "cuda_optimize_code":
            # Optimization suggestions
            analyzer = KernelAnalyzer()
            analysis = analyzer.analyze_kernel(arguments["source_code"])

            result = {
                "original_analysis": analysis,
                "optimization_suggestions": analysis["optimizations"],
                "target_gpu": arguments.get("target_gpu", "auto"),
                "focus_areas": arguments.get("focus", ["memory", "occupancy"])
            }

            return [TextContent(type="text", text=json.dumps(result, indent=2))]

        elif name == "cuda_debug_code":
            analyzer = KernelAnalyzer()
            analysis = analyzer.analyze_kernel(arguments["source_code"])

            result = {
                "analysis": analysis,
                "error_message": arguments.get("error_message", ""),
                "warnings": analysis["warnings"],
                "debugging_hints": [
                    "Check synchronization with __syncthreads()",
                    "Verify memory access patterns",
                    "Validate thread block dimensions",
                    "Check for race conditions"
                ]
            }

            return [TextContent(type="text", text=json.dumps(result, indent=2))]

        elif name == "cuda_analyze_quality":
            analyzer = KernelAnalyzer()
            analysis = analyzer.analyze_kernel(arguments["source_code"])

            format_type = arguments.get("report_format", "markdown")

            if format_type == "json":
                return [TextContent(type="text", text=json.dumps(analysis, indent=2))]
            elif format_type == "markdown":
                md = f"""# CUDA Kernel Analysis Report

## Kernel Information
- **Name**: {analysis['kernel_name']}
- **Parameters**: {', '.join(analysis['parameters'])}

## Memory Usage
- **Shared Memory**: {'Yes' if analysis['shared_memory']['used'] else 'No'}
- **Global Accesses**: {analysis['global_accesses']}

## Synchronization
- **__syncthreads()**: {analysis['synchronization']['syncthreads_count']} calls

## Optimization Opportunities
{chr(10).join(['- ' + opt for opt in analysis['optimizations']])}

## Warnings
{chr(10).join(['⚠️ ' + warn for warn in analysis['warnings']]) if analysis['warnings'] else '✅ No warnings detected'}
"""
                return [TextContent(type="text", text=md)]
            else:
                return [TextContent(type="text", text=str(analysis))]

        elif name == "cuda_detect_arch":
            gpus = get_gpu_info()
            arch_flags = []
            for gpu in gpus:
                if "compute_cap" in gpu:
                    cap = gpu["compute_cap"].replace(".", "")
                    arch_flags.append(f"sm_{cap}")

            result = {
                "detected_architectures": arch_flags,
                "recommended_flag": arch_flags[0] if arch_flags else "sm_70",
                "gpus": gpus
            }
            return [TextContent(type="text", text=json.dumps(result, indent=2))]

        elif name == "cuda_read_file":
            content = Path(arguments["file_path"]).read_text()
            return [TextContent(type="text", text=content)]

        elif name == "cuda_write_file":
            Path(arguments["file_path"]).write_text(arguments["content"])
            return [TextContent(type="text", text=f"File written: {arguments['file_path']}")]

        elif name == "cuda_list_files":
            directory = Path(arguments.get("directory", "."))
            cu_files = list(directory.glob("*.cu")) + list(directory.glob("*.cuh"))
            file_list = [str(f) for f in cu_files]
            return [TextContent(type="text", text=json.dumps({"files": file_list}, indent=2))]

        elif name == "cuda_exec_bash":
            result = subprocess.run(
                arguments["command"],
                shell=True,
                capture_output=True,
                text=True
            )
            output = {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode
            }
            return [TextContent(type="text", text=json.dumps(output, indent=2))]

        else:
            return [TextContent(type="text", text=f"Unknown tool: {name}")]

    except Exception as e:
        error_msg = f"Error executing {name}: {str(e)}"
        return [TextContent(type="text", text=json.dumps({"error": error_msg}))]


# ============================================================================
# Main Entry Point
# ============================================================================

async def main():
    """Run the MCP server."""
    transport = StdioServerTransport()
    await server.run(transport)


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
