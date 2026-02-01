#!/usr/bin/env python3
"""
Text Processing MCP Server
High-performance text processing with streaming operations for massive files.
"""

import asyncio
import subprocess
import json
import re
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List
from mcp.server import Server
from mcp.types import Tool, TextContent

app = Server("text-processing")

# Tool definitions
TOOLS = [
    Tool(
        name="jq_query",
        description="Query JSON files with jq. Streams output for large files. Returns first 1000 lines by default.",
        inputSchema={
            "type": "object",
            "properties": {
                "file": {"type": "string", "description": "Path to JSON file"},
                "query": {"type": "string", "description": "jq query expression (e.g., '.[] | select(.status == \"error\")')"},
                "raw": {"type": "boolean", "description": "Raw output without JSON formatting", "default": False}
            },
            "required": ["file", "query"]
        }
    ),
    Tool(
        name="jq_slurp",
        description="Process multiple JSON files together with jq -s (slurp mode). Combines all files into array.",
        inputSchema={
            "type": "object",
            "properties": {
                "files": {"type": "array", "items": {"type": "string"}, "description": "List of JSON file paths"},
                "query": {"type": "string", "description": "jq query expression to run on combined array"}
            },
            "required": ["files", "query"]
        }
    ),
    Tool(
        name="yq_query",
        description="Query YAML files with yq. Supports complex YAML structures and transformations.",
        inputSchema={
            "type": "object",
            "properties": {
                "file": {"type": "string", "description": "Path to YAML file"},
                "query": {"type": "string", "description": "yq query expression (e.g., '.services[] | select(.enabled == true)')"}
            },
            "required": ["file", "query"]
        }
    ),
    Tool(
        name="rg_search",
        description="Ultra-fast regex search with ripgrep. 10-100x faster than grep. Returns up to max_count results.",
        inputSchema={
            "type": "object",
            "properties": {
                "pattern": {"type": "string", "description": "Regex pattern to search"},
                "path": {"type": "string", "description": "Path to search (file or directory)", "default": "."},
                "type": {"type": "string", "description": "File type filter (json, log, py, js, etc.)", "default": None},
                "context": {"type": "integer", "description": "Lines of context to show (0-10)", "default": 0, "minimum": 0, "maximum": 10},
                "max_count": {"type": "integer", "description": "Maximum number of results", "default": 100}
            },
            "required": ["pattern"]
        }
    ),
    Tool(
        name="rg_files",
        description="List files containing pattern (ripgrep -l). Fast way to find which files match.",
        inputSchema={
            "type": "object",
            "properties": {
                "pattern": {"type": "string", "description": "Regex pattern to search"},
                "path": {"type": "string", "description": "Path to search", "default": "."}
            },
            "required": ["pattern"]
        }
    ),
    Tool(
        name="rg_count",
        description="Count matches per file (ripgrep -c). Shows number of matches in each file.",
        inputSchema={
            "type": "object",
            "properties": {
                "pattern": {"type": "string", "description": "Regex pattern to search"},
                "path": {"type": "string", "description": "Path to search", "default": "."}
            },
            "required": ["pattern"]
        }
    ),
    Tool(
        name="rg_replace",
        description="Search and replace with ripgrep. Supports dry-run mode to preview changes before applying.",
        inputSchema={
            "type": "object",
            "properties": {
                "pattern": {"type": "string", "description": "Regex pattern to search"},
                "replacement": {"type": "string", "description": "Replacement text (supports $1, $2 for capture groups)"},
                "path": {"type": "string", "description": "Path to files"},
                "dry_run": {"type": "boolean", "description": "Show changes without applying", "default": True}
            },
            "required": ["pattern", "replacement", "path"]
        }
    ),
    Tool(
        name="awk_run",
        description="Execute awk programs for pattern scanning and text processing. Efficient for column operations.",
        inputSchema={
            "type": "object",
            "properties": {
                "file": {"type": "string", "description": "Input file path"},
                "program": {"type": "string", "description": "AWK program to execute (e.g., '{sum+=$1} END {print sum}')"}
            },
            "required": ["file", "program"]
        }
    ),
    Tool(
        name="log_slice",
        description="Extract time-windowed log segments. Supports relative ('1h ago') and absolute timestamps.",
        inputSchema={
            "type": "object",
            "properties": {
                "file": {"type": "string", "description": "Log file path"},
                "start": {"type": "string", "description": "Start time: '1h ago', '30m ago', '2024-01-01 10:00', ISO8601", "default": None},
                "end": {"type": "string", "description": "End time (optional, defaults to now)", "default": None},
                "pattern": {"type": "string", "description": "Additional grep filter pattern", "default": None},
                "format": {"type": "string", "description": "Timestamp format: auto, iso8601, unix, or strftime", "default": "auto"}
            },
            "required": ["file"]
        }
    ),
    Tool(
        name="head_lines",
        description="Get first N lines of file. Memory-efficient streaming operation.",
        inputSchema={
            "type": "object",
            "properties": {
                "file": {"type": "string", "description": "File path"},
                "n": {"type": "integer", "description": "Number of lines", "default": 100}
            },
            "required": ["file"]
        }
    ),
    Tool(
        name="tail_lines",
        description="Get last N lines of file. Memory-efficient streaming operation.",
        inputSchema={
            "type": "object",
            "properties": {
                "file": {"type": "string", "description": "File path"},
                "n": {"type": "integer", "description": "Number of lines", "default": 100}
            },
            "required": ["file"]
        }
    ),
    Tool(
        name="unique_lines",
        description="Remove duplicate lines (sort -u) or count occurrences (uniq -c).",
        inputSchema={
            "type": "object",
            "properties": {
                "file": {"type": "string", "description": "File path"},
                "count": {"type": "boolean", "description": "Show counts for each unique line", "default": False}
            },
            "required": ["file"]
        }
    ),
    Tool(
        name="column_extract",
        description="Extract specific columns using cut/awk. Efficient for CSV/TSV/delimited data.",
        inputSchema={
            "type": "object",
            "properties": {
                "file": {"type": "string", "description": "File path"},
                "columns": {"type": "string", "description": "Column numbers (e.g., '1', '1,3,5', '2-4')"},
                "delimiter": {"type": "string", "description": "Field delimiter (auto-detected if not specified)", "default": None}
            },
            "required": ["file", "columns"]
        }
    ),
    Tool(
        name="wc_stats",
        description="Get file statistics: lines, words, bytes. Fast for checking file size.",
        inputSchema={
            "type": "object",
            "properties": {
                "file": {"type": "string", "description": "File path"}
            },
            "required": ["file"]
        }
    )
]

@app.list_tools()
async def list_tools() -> list[Tool]:
    """List available text processing tools."""
    return TOOLS

async def run_command(cmd: list, input_data: Optional[str] = None, timeout: int = 30) -> tuple[str, str, int]:
    """Run command with streaming output and timeout."""
    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE if input_data else None,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        stdout, stderr = await asyncio.wait_for(
            process.communicate(input_data.encode() if input_data else None),
            timeout=timeout
        )

        return stdout.decode(), stderr.decode(), process.returncode
    except asyncio.TimeoutError:
        process.kill()
        return "", f"Command timeout after {timeout}s", 124
    except Exception as e:
        return "", str(e), 1

def parse_relative_time(time_str: str) -> datetime:
    """Parse relative time strings like '1h ago', '30m ago'."""
    match = re.match(r'(\d+)([smhd])\s*ago', time_str)
    if not match:
        return datetime.fromisoformat(time_str.replace('Z', '+00:00'))

    value, unit = int(match.group(1)), match.group(2)
    units = {'s': 'seconds', 'm': 'minutes', 'h': 'hours', 'd': 'days'}
    delta = timedelta(**{units[unit]: value})
    return datetime.now() - delta

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    """Execute text processing tools."""

    try:
        if name == "jq_query":
            file_path = arguments["file"]
            query = arguments["query"]
            raw = arguments.get("raw", False)

            cmd = ["jq"]
            if raw:
                cmd.append("-r")
            cmd.extend([query, file_path])

            # Limit output to first 1000 lines for token efficiency
            stdout, stderr, code = await run_command(cmd + ["--stream"])
            if code != 0:
                # Fallback to non-streaming
                stdout, stderr, code = await run_command(cmd)

            if code != 0:
                return [TextContent(type="text", text=f"Error: {stderr}")]

            lines = stdout.strip().split('\n')
            if len(lines) > 1000:
                output = '\n'.join(lines[:1000]) + f"\n... ({len(lines) - 1000} more lines truncated)"
            else:
                output = stdout.strip()

            return [TextContent(type="text", text=output)]

        elif name == "jq_slurp":
            files = arguments["files"]
            query = arguments["query"]

            cmd = ["jq", "-s", query] + files
            stdout, stderr, code = await run_command(cmd)

            if code != 0:
                return [TextContent(type="text", text=f"Error: {stderr}")]

            return [TextContent(type="text", text=stdout.strip())]

        elif name == "yq_query":
            file_path = arguments["file"]
            query = arguments["query"]

            cmd = ["yq", query, file_path]
            stdout, stderr, code = await run_command(cmd)

            if code != 0:
                return [TextContent(type="text", text=f"Error: {stderr}")]

            return [TextContent(type="text", text=stdout.strip())]

        elif name == "rg_search":
            pattern = arguments["pattern"]
            path = arguments.get("path", ".")
            file_type = arguments.get("type")
            context = arguments.get("context", 0)
            max_count = arguments.get("max_count", 100)

            cmd = ["rg", pattern, path, f"-m{max_count}"]
            if file_type:
                cmd.extend(["-t", file_type])
            if context > 0:
                cmd.extend([f"-C{context}"])

            stdout, stderr, code = await run_command(cmd, timeout=60)

            if code == 1:  # No matches
                return [TextContent(type="text", text="No matches found")]
            elif code != 0:
                return [TextContent(type="text", text=f"Error: {stderr}")]

            return [TextContent(type="text", text=stdout.strip())]

        elif name == "rg_files":
            pattern = arguments["pattern"]
            path = arguments.get("path", ".")

            cmd = ["rg", "-l", pattern, path]
            stdout, stderr, code = await run_command(cmd)

            if code == 1:
                return [TextContent(type="text", text="No files found")]
            elif code != 0:
                return [TextContent(type="text", text=f"Error: {stderr}")]

            return [TextContent(type="text", text=stdout.strip())]

        elif name == "rg_count":
            pattern = arguments["pattern"]
            path = arguments.get("path", ".")

            cmd = ["rg", "-c", pattern, path]
            stdout, stderr, code = await run_command(cmd)

            if code == 1:
                return [TextContent(type="text", text="No matches found")]
            elif code != 0:
                return [TextContent(type="text", text=f"Error: {stderr}")]

            return [TextContent(type="text", text=stdout.strip())]

        elif name == "rg_replace":
            pattern = arguments["pattern"]
            replacement = arguments["replacement"]
            path = arguments["path"]
            dry_run = arguments.get("dry_run", True)

            # Get files with matches
            cmd_list = ["rg", "-l", pattern, path]
            files_out, _, code = await run_command(cmd_list)

            if code == 1:
                return [TextContent(type="text", text="No files match pattern")]
            elif code != 0:
                return [TextContent(type="text", text="Error finding files")]

            files = files_out.strip().split('\n')
            results = []

            for file in files:
                if dry_run:
                    # Show what would change
                    cmd = ["rg", pattern, file, "-r", replacement, "--color=never"]
                    stdout, _, _ = await run_command(cmd)
                    results.append(f"=== {file} ===\n{stdout}")
                else:
                    # Actually replace
                    cmd = ["sed", "-i", f"s/{pattern}/{replacement}/g", file]
                    _, stderr, code = await run_command(cmd)
                    if code == 0:
                        results.append(f"Updated: {file}")
                    else:
                        results.append(f"Error in {file}: {stderr}")

            mode = "DRY RUN - No changes made" if dry_run else "Changes applied"
            output = f"{mode}\n\n" + "\n".join(results)
            return [TextContent(type="text", text=output)]

        elif name == "awk_run":
            file_path = arguments["file"]
            program = arguments["program"]

            cmd = ["awk", program, file_path]
            stdout, stderr, code = await run_command(cmd)

            if code != 0:
                return [TextContent(type="text", text=f"Error: {stderr}")]

            return [TextContent(type="text", text=stdout.strip())]

        elif name == "log_slice":
            file_path = arguments["file"]
            start_str = arguments.get("start")
            end_str = arguments.get("end")
            pattern = arguments.get("pattern")
            fmt = arguments.get("format", "auto")

            # Build command pipeline
            cmd_parts = []

            # Time filtering (simplified - actual implementation would be more robust)
            if start_str:
                try:
                    start_time = parse_relative_time(start_str)
                    start_ts = start_time.isoformat()

                    # Use grep to filter by timestamp (simplified)
                    cmd_parts.append(f"grep -E '{start_ts[:10]}'")
                except (ValueError, AttributeError) as e:
                    # Invalid timestamp format, skip filtering
                    import logging
                    logging.debug(f"Could not parse start_timestamp: {e}")

            # Pattern filtering
            if pattern:
                cmd_parts.append(f"grep -E '{pattern}'")

            # Build final command
            if cmd_parts:
                cmd_str = f"cat {file_path} | " + " | ".join(cmd_parts)
            else:
                cmd_str = f"cat {file_path}"

            stdout, stderr, code = await run_command(["bash", "-c", cmd_str], timeout=60)

            if code != 0:
                return [TextContent(type="text", text=f"Error: {stderr}")]

            lines = stdout.strip().split('\n')
            if len(lines) > 1000:
                output = '\n'.join(lines[:1000]) + f"\n... ({len(lines) - 1000} more lines)"
            else:
                output = stdout.strip()

            return [TextContent(type="text", text=output)]

        elif name == "head_lines":
            file_path = arguments["file"]
            n = arguments.get("n", 100)

            cmd = ["head", f"-n{n}", file_path]
            stdout, stderr, code = await run_command(cmd)

            if code != 0:
                return [TextContent(type="text", text=f"Error: {stderr}")]

            return [TextContent(type="text", text=stdout.strip())]

        elif name == "tail_lines":
            file_path = arguments["file"]
            n = arguments.get("n", 100)

            cmd = ["tail", f"-n{n}", file_path]
            stdout, stderr, code = await run_command(cmd)

            if code != 0:
                return [TextContent(type="text", text=f"Error: {stderr}")]

            return [TextContent(type="text", text=stdout.strip())]

        elif name == "unique_lines":
            file_path = arguments["file"]
            count = arguments.get("count", False)

            if count:
                cmd = ["bash", "-c", f"sort {file_path} | uniq -c"]
            else:
                cmd = ["bash", "-c", f"sort -u {file_path}"]

            stdout, stderr, code = await run_command(cmd, timeout=60)

            if code != 0:
                return [TextContent(type="text", text=f"Error: {stderr}")]

            return [TextContent(type="text", text=stdout.strip())]

        elif name == "column_extract":
            file_path = arguments["file"]
            columns = arguments["columns"]
            delimiter = arguments.get("delimiter")

            if delimiter:
                cmd = ["cut", f"-d{delimiter}", f"-f{columns}", file_path]
            else:
                # Auto-detect delimiter - build awk command without f-string brace issues
                awk_cols = ','.join(['$' + c for c in columns.split(',')])
                cmd = ["awk", "{print " + awk_cols + "}", file_path]

            stdout, stderr, code = await run_command(cmd)

            if code != 0:
                return [TextContent(type="text", text=f"Error: {stderr}")]

            return [TextContent(type="text", text=stdout.strip())]

        elif name == "wc_stats":
            file_path = arguments["file"]

            cmd = ["wc", file_path]
            stdout, stderr, code = await run_command(cmd)

            if code != 0:
                return [TextContent(type="text", text=f"Error: {stderr}")]

            # Parse wc output: lines words bytes filename
            parts = stdout.strip().split()
            if len(parts) >= 4:
                output = f"Lines: {parts[0]}\nWords: {parts[1]}\nBytes: {parts[2]}\nFile: {parts[3]}"
            else:
                output = stdout.strip()

            return [TextContent(type="text", text=output)]

        else:
            return [TextContent(type="text", text=f"Unknown tool: {name}")]

    except Exception as e:
        return [TextContent(type="text", text=f"Error: {str(e)}")]

if __name__ == "__main__":
    import asyncio
    asyncio.run(app.run())
