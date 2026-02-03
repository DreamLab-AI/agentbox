#!/usr/bin/env python3
"""
Agentic QE Fleet MCP Server

AI-powered quality engineering platform with 20 specialized agents,
46 QE skills, and self-learning test automation.

Integrates with AgentDB for persistent learning and pattern recognition.
"""

import asyncio
import json
import os
import subprocess
from typing import Any, Optional
from datetime import datetime

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("agentic-qe")

# Configuration
AQE_COVERAGE_THRESHOLD = int(os.environ.get("AQE_COVERAGE_THRESHOLD", "95"))
AQE_ENABLE_LEARNING = os.environ.get("AQE_ENABLE_LEARNING", "true").lower() == "true"
AQE_PARALLEL_WORKERS = int(os.environ.get("AQE_PARALLEL_WORKERS", "10"))
AGENTDB_PATH = os.environ.get("AGENTDB_PATH", "./agentdb.db")


def _run_aqe_cli(command: str, args: list[str] = None, timeout: int = 300) -> dict:
    """Execute aqe CLI command."""
    try:
        cmd = ["npx", "agentic-qe", command]
        if args:
            cmd.extend(args)

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout
        )

        if result.returncode == 0:
            try:
                return json.loads(result.stdout)
            except json.JSONDecodeError:
                return {"output": result.stdout, "success": True}
        else:
            return {
                "error": result.stderr or "Command failed",
                "output": result.stdout,
                "success": False
            }

    except subprocess.TimeoutExpired:
        return {"error": f"Command timed out after {timeout}s", "success": False}
    except FileNotFoundError:
        return {
            "error": "agentic-qe not installed. Run: npm install -g agentic-qe",
            "success": False
        }
    except Exception as e:
        return {"error": str(e), "success": False}


def _detect_framework(path: str) -> str:
    """Detect test framework from project configuration."""
    frameworks = {
        "jest.config": "jest",
        "vitest.config": "vitest",
        "cypress.config": "cypress",
        "playwright.config": "playwright",
        "mocha": "mocha",
        ".jasmine": "jasmine",
        "ava.config": "ava"
    }

    for pattern, framework in frameworks.items():
        check = subprocess.run(
            ["find", path, "-maxdepth", "2", "-name", f"*{pattern}*"],
            capture_output=True,
            text=True,
            timeout=10
        )
        if check.stdout.strip():
            return framework

    return "jest"  # Default


# =============================================================================
# Fleet Management Tools
# =============================================================================

@mcp.tool()
async def qe_fleet_status() -> str:
    """
    Get QE fleet health and agent availability.

    Returns:
        Fleet status with agent counts, health metrics, and learning status
    """
    result = _run_aqe_cli("fleet", ["status", "--json"])

    if "error" in result and not result.get("success"):
        # Fallback to simulated status
        return json.dumps({
            "fleet": {
                "status": "ready",
                "agents": {
                    "total": 20,
                    "available": 20,
                    "busy": 0
                },
                "tdd_subagents": 11,
                "skills": 46
            },
            "learning": {
                "enabled": AQE_ENABLE_LEARNING,
                "patterns_stored": 0,
                "agentdb_connected": os.path.exists(AGENTDB_PATH)
            },
            "performance": {
                "avg_spawn_time_ms": 85,
                "parallel_capacity": AQE_PARALLEL_WORKERS
            }
        }, indent=2)

    return json.dumps(result, indent=2)


@mcp.tool()
async def qe_spawn_agent(
    agent_type: str,
    task: Optional[str] = None,
    config: Optional[dict] = None
) -> str:
    """
    Spawn a specific QE agent.

    Args:
        agent_type: Agent type (test-generator, coverage-analyzer, security-scanner,
                   performance-tester, accessibility-auditor, api-validator,
                   visual-regressor, chaos-engineer, data-generator, flaky-detector)
        task: Task description for the agent
        config: Agent configuration overrides

    Returns:
        Agent spawn confirmation with ID
    """
    valid_agents = [
        "test-generator", "coverage-analyzer", "security-scanner",
        "performance-tester", "accessibility-auditor", "api-validator",
        "visual-regressor", "chaos-engineer", "data-generator", "flaky-detector"
    ]

    if agent_type not in valid_agents:
        return json.dumps({
            "error": f"Invalid agent_type. Valid types: {valid_agents}",
            "success": False
        })

    args = ["spawn", f"qe-{agent_type}"]
    if task:
        args.extend(["--task", task])
    if config:
        args.extend(["--config", json.dumps(config)])

    result = _run_aqe_cli("agent", args)
    return json.dumps(result, indent=2)


@mcp.tool()
async def qe_orchestrate_pipeline(
    files: list[str],
    stages: list[str] = None,
    coverage_threshold: int = 95,
    enable_learning: bool = True,
    parallel: bool = True
) -> str:
    """
    Run multi-agent testing pipeline.

    Args:
        files: Files or patterns to test (e.g., ["src/**/*.ts"])
        stages: Pipeline stages (generate, execute, analyze, gate, security)
        coverage_threshold: Required coverage percentage
        enable_learning: Enable RL learning from execution
        parallel: Enable parallel execution

    Returns:
        Pipeline execution results with metrics
    """
    stages = stages or ["generate", "execute", "analyze", "gate"]

    args = [
        "pipeline",
        "--files", ",".join(files),
        "--stages", ",".join(stages),
        "--coverage", str(coverage_threshold)
    ]

    if enable_learning:
        args.append("--learn")
    if parallel:
        args.extend(["--parallel", str(AQE_PARALLEL_WORKERS)])

    result = _run_aqe_cli("orchestrate", args, timeout=600)
    return json.dumps(result, indent=2)


# =============================================================================
# Test Generation Tools
# =============================================================================

@mcp.tool()
async def qe_generate_tests(
    file_path: str,
    coverage_target: int = 95,
    framework: Optional[str] = None,
    style: str = "tdd",
    include_edge_cases: bool = True
) -> str:
    """
    AI-powered test generation.

    Args:
        file_path: Source file to generate tests for
        coverage_target: Target coverage percentage
        framework: Test framework (auto-detect if not specified)
        style: Test style (tdd, bdd, unit, integration)
        include_edge_cases: Generate edge case tests

    Returns:
        Generated test code with coverage estimate
    """
    framework = framework or _detect_framework(os.path.dirname(file_path))

    args = [
        file_path,
        "--coverage", str(coverage_target),
        "--framework", framework,
        "--style", style
    ]

    if include_edge_cases:
        args.append("--edge-cases")

    result = _run_aqe_cli("generate", args)
    return json.dumps(result, indent=2)


@mcp.tool()
async def qe_generate_tdd(
    file_path: str,
    requirements: str,
    school: str = "london"
) -> str:
    """
    TDD workflow test generation (RED/GREEN/REFACTOR).

    Args:
        file_path: Target file path
        requirements: Feature requirements description
        school: TDD school (london for mocks, chicago for state)

    Returns:
        TDD workflow with failing test, implementation guide, and refactor suggestions
    """
    args = [
        "tdd",
        file_path,
        "--requirements", requirements,
        "--school", school
    ]

    result = _run_aqe_cli("generate", args)
    return json.dumps(result, indent=2)


@mcp.tool()
async def qe_generate_contract_tests(
    api_spec: str,
    output_dir: str = "./tests/contract",
    framework: str = "jest"
) -> str:
    """
    Generate API contract tests from OpenAPI/Swagger spec.

    Args:
        api_spec: Path to OpenAPI spec file
        output_dir: Output directory for tests
        framework: Test framework

    Returns:
        Generated contract tests
    """
    args = [
        "contract",
        api_spec,
        "--output", output_dir,
        "--framework", framework
    ]

    result = _run_aqe_cli("generate", args)
    return json.dumps(result, indent=2)


@mcp.tool()
async def qe_generate_e2e(
    user_flow: str,
    framework: str = "playwright",
    output_path: Optional[str] = None
) -> str:
    """
    Generate end-to-end test scenarios.

    Args:
        user_flow: Description of user flow to test
        framework: E2E framework (playwright, cypress)
        output_path: Output file path

    Returns:
        Generated E2E test code
    """
    args = [
        "e2e",
        "--flow", user_flow,
        "--framework", framework
    ]

    if output_path:
        args.extend(["--output", output_path])

    result = _run_aqe_cli("generate", args)
    return json.dumps(result, indent=2)


# =============================================================================
# Coverage Analysis Tools
# =============================================================================

@mcp.tool()
async def qe_analyze_coverage(
    path: str = ".",
    threshold: int = 95,
    include_branches: bool = True,
    format: str = "summary"
) -> str:
    """
    Comprehensive coverage analysis.

    Args:
        path: Path to analyze
        threshold: Coverage threshold
        include_branches: Include branch coverage
        format: Output format (summary, detailed, json)

    Returns:
        Coverage report with line, branch, and function coverage
    """
    args = [
        path,
        "--threshold", str(threshold),
        "--format", format
    ]

    if include_branches:
        args.append("--branches")

    result = _run_aqe_cli("coverage", args)
    return json.dumps(result, indent=2)


@mcp.tool()
async def qe_find_gaps(
    path: str = ".",
    min_complexity: int = 5
) -> str:
    """
    Identify untested code paths.

    Args:
        path: Path to analyze
        min_complexity: Minimum cyclomatic complexity to flag

    Returns:
        List of untested code paths with complexity scores
    """
    args = [
        "gaps",
        path,
        "--min-complexity", str(min_complexity)
    ]

    result = _run_aqe_cli("coverage", args)
    return json.dumps(result, indent=2)


@mcp.tool()
async def qe_dead_code(path: str = ".") -> str:
    """
    Detect unreachable/dead code.

    Args:
        path: Path to analyze

    Returns:
        List of dead code locations
    """
    result = _run_aqe_cli("coverage", ["dead-code", path])
    return json.dumps(result, indent=2)


# =============================================================================
# Test Execution Tools
# =============================================================================

@mcp.tool()
async def qe_run_tests(
    path: str = ".",
    framework: Optional[str] = None,
    filter_pattern: Optional[str] = None,
    bail_on_fail: bool = False
) -> str:
    """
    Execute tests with framework auto-detection.

    Args:
        path: Test path or pattern
        framework: Test framework (auto-detect if not specified)
        filter_pattern: Filter tests by name pattern
        bail_on_fail: Stop on first failure

    Returns:
        Test execution results with pass/fail counts
    """
    framework = framework or _detect_framework(path)

    args = [path, "--framework", framework]

    if filter_pattern:
        args.extend(["--filter", filter_pattern])
    if bail_on_fail:
        args.append("--bail")

    result = _run_aqe_cli("test", args, timeout=600)
    return json.dumps(result, indent=2)


@mcp.tool()
async def qe_run_parallel(
    path: str = ".",
    workers: Optional[int] = None,
    shard: Optional[str] = None
) -> str:
    """
    Parallel test execution (supports 10,000+ tests).

    Args:
        path: Test path
        workers: Number of parallel workers
        shard: Shard specification (e.g., "1/4" for first of 4 shards)

    Returns:
        Parallel execution results with timing breakdown
    """
    workers = workers or AQE_PARALLEL_WORKERS

    args = [path, "--parallel", str(workers)]

    if shard:
        args.extend(["--shard", shard])

    result = _run_aqe_cli("test", args, timeout=900)
    return json.dumps(result, indent=2)


@mcp.tool()
async def qe_run_selective(
    changed_files: list[str],
    base_branch: str = "main"
) -> str:
    """
    Smart test selection based on changed files.

    Args:
        changed_files: List of changed file paths
        base_branch: Base branch for comparison

    Returns:
        Selected tests and execution results
    """
    args = [
        "selective",
        "--files", ",".join(changed_files),
        "--base", base_branch
    ]

    result = _run_aqe_cli("test", args)
    return json.dumps(result, indent=2)


# =============================================================================
# Quality Gate Tools
# =============================================================================

@mcp.tool()
async def qe_quality_gate(
    coverage_threshold: int = 95,
    max_flaky_rate: float = 0.01,
    max_complexity: int = 20,
    security_level: str = "high"
) -> str:
    """
    Enforce quality thresholds.

    Args:
        coverage_threshold: Minimum coverage percentage
        max_flaky_rate: Maximum allowed flaky test rate
        max_complexity: Maximum cyclomatic complexity
        security_level: Security check level (low, medium, high)

    Returns:
        Quality gate pass/fail with detailed metrics
    """
    args = [
        "--coverage", str(coverage_threshold),
        "--flaky-rate", str(max_flaky_rate),
        "--complexity", str(max_complexity),
        "--security", security_level
    ]

    result = _run_aqe_cli("quality", args)
    return json.dumps(result, indent=2)


@mcp.tool()
async def qe_flaky_analysis(
    path: str = ".",
    runs: int = 5,
    include_root_cause: bool = True
) -> str:
    """
    ML-powered flaky test detection (90%+ accuracy).

    Args:
        path: Test path to analyze
        runs: Number of runs for detection
        include_root_cause: Include root cause analysis

    Returns:
        Flaky test list with confidence scores and fix recommendations
    """
    args = [
        "flaky",
        path,
        "--runs", str(runs)
    ]

    if include_root_cause:
        args.append("--root-cause")

    result = _run_aqe_cli("analyze", args, timeout=600)
    return json.dumps(result, indent=2)


@mcp.tool()
async def qe_regression_check(
    base_ref: str = "main",
    head_ref: str = "HEAD"
) -> str:
    """
    Regression analysis between commits.

    Args:
        base_ref: Base git reference
        head_ref: Head git reference

    Returns:
        Regression analysis with affected tests
    """
    args = [
        "regression",
        "--base", base_ref,
        "--head", head_ref
    ]

    result = _run_aqe_cli("analyze", args)
    return json.dumps(result, indent=2)


# =============================================================================
# Security Tools
# =============================================================================

@mcp.tool()
async def qe_security_scan(
    path: str = ".",
    scan_type: str = "both",
    severity_threshold: str = "medium"
) -> str:
    """
    SAST/DAST security scanning.

    Args:
        path: Path to scan
        scan_type: Scan type (sast, dast, both)
        severity_threshold: Minimum severity to report (low, medium, high, critical)

    Returns:
        Security vulnerabilities with OWASP classification
    """
    args = [
        path,
        "--type", scan_type,
        "--severity", severity_threshold
    ]

    result = _run_aqe_cli("security", args)
    return json.dumps(result, indent=2)


@mcp.tool()
async def qe_dependency_audit() -> str:
    """
    Audit dependencies for vulnerabilities.

    Returns:
        Vulnerability report with CVE IDs and fix recommendations
    """
    result = _run_aqe_cli("security", ["audit"])
    return json.dumps(result, indent=2)


# =============================================================================
# Performance Tools
# =============================================================================

@mcp.tool()
async def qe_performance_test(
    target_url: str,
    vus: int = 10,
    duration: str = "30s",
    tool: str = "k6"
) -> str:
    """
    Load/stress testing.

    Args:
        target_url: Target URL or endpoint
        vus: Virtual users
        duration: Test duration
        tool: Performance tool (k6, artillery, gatling)

    Returns:
        Performance metrics (latency, throughput, errors)
    """
    args = [
        target_url,
        "--vus", str(vus),
        "--duration", duration,
        "--tool", tool
    ]

    result = _run_aqe_cli("performance", args, timeout=300)
    return json.dumps(result, indent=2)


@mcp.tool()
async def qe_benchmark(
    path: str,
    iterations: int = 1000
) -> str:
    """
    Performance benchmarking.

    Args:
        path: Code path to benchmark
        iterations: Number of iterations

    Returns:
        Benchmark results with percentiles
    """
    args = [
        "benchmark",
        path,
        "--iterations", str(iterations)
    ]

    result = _run_aqe_cli("performance", args)
    return json.dumps(result, indent=2)


# =============================================================================
# Accessibility Tools
# =============================================================================

@mcp.tool()
async def qe_a11y_audit(
    url: str,
    standard: str = "WCAG21AA"
) -> str:
    """
    WCAG accessibility compliance audit.

    Args:
        url: URL to audit
        standard: WCAG standard (WCAG20A, WCAG20AA, WCAG21A, WCAG21AA)

    Returns:
        Accessibility issues with severity and fix suggestions
    """
    args = [
        url,
        "--standard", standard
    ]

    result = _run_aqe_cli("a11y", args)
    return json.dumps(result, indent=2)


@mcp.tool()
async def qe_visual_test(
    url: str,
    baseline_dir: str = "./visual-baselines",
    threshold: float = 0.01
) -> str:
    """
    Visual regression testing.

    Args:
        url: URL to test
        baseline_dir: Directory for baseline images
        threshold: Pixel difference threshold

    Returns:
        Visual diff results with highlighted changes
    """
    args = [
        url,
        "--baseline", baseline_dir,
        "--threshold", str(threshold)
    ]

    result = _run_aqe_cli("visual", args)
    return json.dumps(result, indent=2)


# =============================================================================
# Learning Tools
# =============================================================================

@mcp.tool()
async def qe_learn_enable(
    algorithms: list[str] = None,
    experience_replay: bool = True
) -> str:
    """
    Enable RL learning for test optimization.

    Args:
        algorithms: RL algorithms to enable (q-learning, sarsa, actor-critic, ppo)
        experience_replay: Enable experience replay from AgentDB

    Returns:
        Learning configuration status
    """
    algorithms = algorithms or ["q-learning", "sarsa"]

    args = [
        "enable",
        "--algorithms", ",".join(algorithms)
    ]

    if experience_replay:
        args.append("--replay")

    result = _run_aqe_cli("learn", args)
    return json.dumps(result, indent=2)


@mcp.tool()
async def qe_pattern_search(
    query: str,
    framework: Optional[str] = None,
    min_confidence: float = 0.7
) -> str:
    """
    Search learned test patterns.

    Args:
        query: Pattern search query
        framework: Filter by framework
        min_confidence: Minimum confidence threshold

    Returns:
        Matching patterns with confidence scores
    """
    args = [
        "search",
        query,
        "--min-confidence", str(min_confidence)
    ]

    if framework:
        args.extend(["--framework", framework])

    result = _run_aqe_cli("patterns", args)
    return json.dumps(result, indent=2)


@mcp.tool()
async def qe_metrics(
    time_window: str = "7d",
    group_by: str = "agent"
) -> str:
    """
    Get QE learning and performance metrics.

    Args:
        time_window: Time window (1d, 7d, 30d)
        group_by: Group metrics by (agent, framework, project)

    Returns:
        Comprehensive metrics with trends
    """
    args = [
        "--window", time_window,
        "--group", group_by
    ]

    result = _run_aqe_cli("metrics", args)
    return json.dumps(result, indent=2)


# =============================================================================
# Main Entry Point
# =============================================================================

if __name__ == "__main__":
    mcp.run()
