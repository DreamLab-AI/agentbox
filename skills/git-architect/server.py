#!/usr/bin/env python3
"""
Git Architect MCP Server
High-level repository analysis and semantic code search
"""

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Any
from collections import defaultdict, Counter

from mcp.server.fastmcp import FastMCP
import git

# Initialize FastMCP server
mcp = FastMCP("git-architect")

# Default ignore patterns for token optimization
DEFAULT_IGNORE = [
    "node_modules",
    ".git",
    "__pycache__",
    "*.lock",
    "dist",
    "build",
    ".next",
    "target",
    "vendor",
    ".venv",
    "venv",
    "*.pyc",
    ".DS_Store",
    "*.min.js",
    "*.min.css",
    "*.map",
]

BINARY_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg",
    ".pdf", ".zip", ".tar", ".gz", ".bz2",
    ".exe", ".dll", ".so", ".dylib",
    ".woff", ".woff2", ".ttf", ".eot",
    ".mp4", ".mp3", ".avi", ".mov"
}


def get_repo(path: str = ".") -> git.Repo:
    """Get git repository instance."""
    try:
        return git.Repo(path, search_parent_directories=True)
    except git.InvalidGitRepositoryError:
        raise ValueError(f"Not a git repository: {path}")


def should_ignore(path: Path, patterns: List[str]) -> bool:
    """Check if path matches ignore patterns."""
    path_str = str(path)
    for pattern in patterns:
        if pattern.startswith("*."):
            ext = pattern[1:]
            if path_str.endswith(ext):
                return True
        elif pattern in path.parts:
            return True
    return False


def is_binary_file(path: Path) -> bool:
    """Heuristic check for binary files."""
    if path.suffix.lower() in BINARY_EXTENSIONS:
        return True

    try:
        with open(path, 'rb') as f:
            chunk = f.read(1024)
            return b'\0' in chunk
    except:
        return False


def format_size(size_bytes: int) -> str:
    """Format file size human-readable."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.1f}{unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.1f}TB"


@mcp.tool()
def repo_map(
    path: str = ".",
    max_depth: int = 3,
    show_size: bool = False,
    ignore_patterns: Optional[List[str]] = None
) -> str:
    """
    Generate token-optimized repository tree view.

    Args:
        path: Repository path (default: current directory)
        max_depth: Maximum directory depth to traverse
        show_size: Include file sizes in output
        ignore_patterns: Additional patterns to ignore

    Returns:
        Hierarchical tree structure
    """
    repo = get_repo(path)
    root = Path(repo.working_dir)

    patterns = DEFAULT_IGNORE + (ignore_patterns or [])
    lines = [f"Repository: {root.name}"]
    lines.append(f"Branch: {repo.active_branch.name}")
    lines.append("")

    def walk_tree(current: Path, prefix: str = "", depth: int = 0):
        if depth >= max_depth:
            return

        try:
            items = sorted(current.iterdir(), key=lambda x: (not x.is_dir(), x.name))
        except PermissionError:
            return

        for i, item in enumerate(items):
            if should_ignore(item.relative_to(root), patterns):
                continue

            is_last = i == len(items) - 1
            connector = "└── " if is_last else "├── "
            line = f"{prefix}{connector}{item.name}"

            if item.is_file() and show_size:
                size = format_size(item.stat().st_size)
                line += f" ({size})"

            lines.append(line)

            if item.is_dir():
                extension = "    " if is_last else "│   "
                walk_tree(item, prefix + extension, depth + 1)

    walk_tree(root)
    return "\n".join(lines)


@mcp.tool()
def smart_diff(
    base: str = "main",
    exclude: Optional[List[str]] = None,
    path: str = "."
) -> Dict[str, Any]:
    """
    Context-aware diff that excludes noise.

    Args:
        base: Base branch to compare against
        exclude: Additional patterns to exclude
        path: Repository path

    Returns:
        Filtered diff with statistics
    """
    repo = get_repo(path)

    # Merge exclude patterns
    exclude_patterns = DEFAULT_IGNORE + (exclude or [])

    try:
        # Get diff between base and current HEAD
        base_commit = repo.commit(base)
        head_commit = repo.head.commit

        diff_index = base_commit.diff(head_commit)
    except (git.BadName, git.GitCommandError) as e:
        return {"error": f"Failed to get diff: {str(e)}"}

    filtered_changes = {
        "added": [],
        "modified": [],
        "deleted": [],
        "renamed": [],
        "total_additions": 0,
        "total_deletions": 0
    }

    for diff in diff_index:
        file_path = diff.a_path or diff.b_path

        # Apply filters
        if any(pattern in file_path for pattern in exclude_patterns):
            continue

        path_obj = Path(file_path)
        if path_obj.suffix.lower() in BINARY_EXTENSIONS:
            continue

        change_type = diff.change_type
        stats = {
            "file": file_path,
            "additions": 0,
            "deletions": 0
        }

        # Get detailed stats if possible
        try:
            if diff.diff:
                diff_text = diff.diff.decode('utf-8', errors='ignore')
                stats["additions"] = diff_text.count('\n+') - diff_text.count('\n+++')
                stats["deletions"] = diff_text.count('\n-') - diff_text.count('\n---')
        except (AttributeError, UnicodeDecodeError) as e:
            import logging
            logging.warning(f"Failed to parse diff stats: {e}")

        filtered_changes["total_additions"] += stats["additions"]
        filtered_changes["total_deletions"] += stats["deletions"]

        if change_type == "A":
            filtered_changes["added"].append(stats)
        elif change_type == "M":
            filtered_changes["modified"].append(stats)
        elif change_type == "D":
            filtered_changes["deleted"].append(stats)
        elif change_type == "R":
            filtered_changes["renamed"].append({
                "from": diff.a_path,
                "to": diff.b_path
            })

    return filtered_changes


@mcp.tool()
def file_history(
    file: str,
    limit: int = 10,
    stat: bool = False,
    path: str = "."
) -> List[Dict[str, Any]]:
    """
    Track file evolution over time.

    Args:
        file: File path relative to repo root
        limit: Maximum number of commits
        stat: Include change statistics
        path: Repository path

    Returns:
        List of commits affecting the file
    """
    repo = get_repo(path)

    try:
        commits = list(repo.iter_commits(paths=file, max_count=limit))
    except git.GitCommandError as e:
        return [{"error": f"Failed to get history: {str(e)}"}]

    history = []
    for commit in commits:
        entry = {
            "sha": commit.hexsha[:8],
            "author": commit.author.name,
            "date": commit.committed_datetime.isoformat(),
            "message": commit.message.strip().split('\n')[0]
        }

        if stat and commit.parents:
            try:
                parent = commit.parents[0]
                diffs = parent.diff(commit, paths=file)
                if diffs:
                    diff = diffs[0]
                    entry["additions"] = diff.diff.decode('utf-8', errors='ignore').count('\n+')
                    entry["deletions"] = diff.diff.decode('utf-8', errors='ignore').count('\n-')
            except (AttributeError, UnicodeDecodeError) as e:
                import logging
                logging.warning(f"Failed to decode diff for {entry.get('file', 'unknown')}: {e}")

        history.append(entry)

    return history


@mcp.tool()
def blame_summary(file: str, path: str = ".") -> Dict[str, Any]:
    """
    Aggregated authorship analysis.

    Args:
        file: File path relative to repo root
        path: Repository path

    Returns:
        Author contribution statistics
    """
    repo = get_repo(path)

    try:
        blame_lines = repo.blame('HEAD', file)
    except git.GitCommandError as e:
        return {"error": f"Failed to get blame: {str(e)}"}

    author_stats = Counter()
    total_lines = 0

    for commit, lines in blame_lines:
        line_count = len(lines)
        author_stats[commit.author.name] += line_count
        total_lines += line_count

    summary = {
        "file": file,
        "total_lines": total_lines,
        "contributors": []
    }

    for author, count in author_stats.most_common():
        percentage = (count / total_lines * 100) if total_lines > 0 else 0
        summary["contributors"].append({
            "author": author,
            "lines": count,
            "percentage": round(percentage, 1)
        })

    return summary


@mcp.tool()
def branch_diff(
    branch1: str,
    branch2: str,
    path: str = "."
) -> Dict[str, Any]:
    """
    Compare two branches at high level.

    Args:
        branch1: First branch name
        branch2: Second branch name
        path: Repository path

    Returns:
        Branch comparison summary
    """
    repo = get_repo(path)

    try:
        commit1 = repo.commit(branch1)
        commit2 = repo.commit(branch2)
    except git.BadName as e:
        return {"error": f"Invalid branch: {str(e)}"}

    diff_index = commit1.diff(commit2)

    authors = set()
    commits_between = list(repo.iter_commits(f"{branch1}..{branch2}"))

    for commit in commits_between:
        authors.add(commit.author.name)

    return {
        "branch1": branch1,
        "branch2": branch2,
        "files_changed": len(diff_index),
        "files": [d.a_path or d.b_path for d in diff_index],
        "commits_ahead": len(commits_between),
        "authors": list(authors)
    }


@mcp.tool()
def recent_changes(
    days: int = 7,
    author: Optional[str] = None,
    path: str = "."
) -> List[Dict[str, Any]]:
    """
    What changed recently?

    Args:
        days: Number of days to look back
        author: Filter by author email/name
        path: Repository path

    Returns:
        Recent commits with details
    """
    repo = get_repo(path)

    since_date = datetime.now() - timedelta(days=days)
    commits = repo.iter_commits(since=since_date.isoformat())

    changes = []
    for commit in commits:
        if author and author.lower() not in commit.author.name.lower() and author.lower() not in commit.author.email.lower():
            continue

        changes.append({
            "sha": commit.hexsha[:8],
            "author": commit.author.name,
            "date": commit.committed_datetime.isoformat(),
            "message": commit.message.strip().split('\n')[0],
            "files_changed": len(commit.stats.files)
        })

    return changes


@mcp.tool()
def hotspots(
    path: str = ".",
    limit: int = 10,
    repo_path: str = "."
) -> List[Dict[str, Any]]:
    """
    Find most frequently changed files.

    Args:
        path: Path within repository to analyze
        limit: Maximum number of files to return
        repo_path: Repository root path

    Returns:
        Files sorted by change frequency
    """
    repo = get_repo(repo_path)

    file_changes = Counter()

    for commit in repo.iter_commits():
        for file_path in commit.stats.files:
            if path == "." or file_path.startswith(path):
                file_changes[file_path] += 1

    hotspots_list = []
    for file, count in file_changes.most_common(limit):
        hotspots_list.append({
            "file": file,
            "changes": count
        })

    return hotspots_list


@mcp.tool()
def contributors(path: str = ".", repo_path: str = ".") -> Dict[str, Any]:
    """
    Understand who works on what.

    Args:
        path: Path within repository
        repo_path: Repository root path

    Returns:
        Contributor statistics
    """
    repo = get_repo(repo_path)

    author_stats = defaultdict(lambda: {"commits": 0, "files": set()})

    for commit in repo.iter_commits(paths=path if path != "." else None):
        author = commit.author.name
        author_stats[author]["commits"] += 1

        for file_path in commit.stats.files:
            author_stats[author]["files"].add(file_path)

    contributors_list = []
    for author, stats in author_stats.items():
        contributors_list.append({
            "author": author,
            "commits": stats["commits"],
            "files_touched": len(stats["files"])
        })

    contributors_list.sort(key=lambda x: x["commits"], reverse=True)

    return {
        "path": path,
        "total_contributors": len(contributors_list),
        "contributors": contributors_list
    }


@mcp.tool()
def file_co_changes(
    file: str,
    limit: int = 10,
    path: str = "."
) -> List[Dict[str, Any]]:
    """
    Discover files that change together.

    Args:
        file: Target file path
        limit: Maximum files to return
        path: Repository path

    Returns:
        Files frequently changed with target
    """
    repo = get_repo(path)

    co_change_counts = Counter()

    for commit in repo.iter_commits(paths=file):
        changed_files = list(commit.stats.files.keys())

        for changed_file in changed_files:
            if changed_file != file:
                co_change_counts[changed_file] += 1

    co_changes = []
    for co_file, count in co_change_counts.most_common(limit):
        co_changes.append({
            "file": co_file,
            "co_changes": count
        })

    return co_changes


@mcp.tool()
def find_large_files(
    path: str = ".",
    top_n: int = 10,
    threshold_kb: int = 100
) -> List[Dict[str, Any]]:
    """
    Identify large files in repository.

    Args:
        path: Repository path
        top_n: Number of largest files to return
        threshold_kb: Minimum size in KB

    Returns:
        Large files with sizes
    """
    repo = get_repo(path)
    root = Path(repo.working_dir)

    large_files = []

    for item in root.rglob("*"):
        if item.is_file() and not should_ignore(item.relative_to(root), DEFAULT_IGNORE):
            try:
                size_bytes = item.stat().st_size
                size_kb = size_bytes / 1024

                if size_kb >= threshold_kb:
                    large_files.append({
                        "file": str(item.relative_to(root)),
                        "size": format_size(size_bytes),
                        "size_kb": int(size_kb)
                    })
            except:
                continue

    large_files.sort(key=lambda x: x["size_kb"], reverse=True)
    return large_files[:top_n]


@mcp.tool()
def stale_branches(days: int = 30, path: str = ".") -> List[Dict[str, Any]]:
    """
    Find branches with no recent commits.

    Args:
        days: Age threshold in days
        path: Repository path

    Returns:
        Stale branches list
    """
    repo = get_repo(path)

    threshold_date = datetime.now() - timedelta(days=days)
    stale = []

    for ref in repo.refs:
        if not ref.name.startswith('origin/'):
            continue

        try:
            last_commit = ref.commit
            commit_date = datetime.fromtimestamp(last_commit.committed_date)

            if commit_date < threshold_date:
                days_old = (datetime.now() - commit_date).days
                stale.append({
                    "branch": ref.name,
                    "last_commit_date": commit_date.isoformat(),
                    "days_old": days_old,
                    "last_author": last_commit.author.name
                })
        except:
            continue

    stale.sort(key=lambda x: x["days_old"], reverse=True)
    return stale


@mcp.tool()
def commit_stats(
    since: Optional[str] = None,
    until: Optional[str] = None,
    path: str = "."
) -> Dict[str, Any]:
    """
    Repository activity statistics.

    Args:
        since: Start date (ISO format)
        until: End date (ISO format)
        path: Repository path

    Returns:
        Commit statistics
    """
    repo = get_repo(path)

    kwargs = {}
    if since:
        kwargs['since'] = since
    if until:
        kwargs['until'] = until

    commits = list(repo.iter_commits(**kwargs))

    author_commits = Counter()
    total_additions = 0
    total_deletions = 0
    files_changed = set()

    for commit in commits:
        author_commits[commit.author.name] += 1

        for file_path, stats in commit.stats.files.items():
            files_changed.add(file_path)
            total_additions += stats['insertions']
            total_deletions += stats['deletions']

    return {
        "total_commits": len(commits),
        "total_authors": len(author_commits),
        "total_additions": total_additions,
        "total_deletions": total_deletions,
        "files_changed": len(files_changed),
        "top_contributors": [
            {"author": author, "commits": count}
            for author, count in author_commits.most_common(10)
        ]
    }


@mcp.tool()
def search_commits(
    query: str,
    limit: int = 20,
    path: str = "."
) -> List[Dict[str, Any]]:
    """
    Search commit messages.

    Args:
        query: Search query
        limit: Maximum results
        path: Repository path

    Returns:
        Matching commits
    """
    repo = get_repo(path)

    results = []

    for commit in repo.iter_commits(max_count=1000):
        if query.lower() in commit.message.lower():
            results.append({
                "sha": commit.hexsha[:8],
                "author": commit.author.name,
                "date": commit.committed_datetime.isoformat(),
                "message": commit.message.strip().split('\n')[0],
                "files": list(commit.stats.files.keys())
            })

            if len(results) >= limit:
                break

    return results


if __name__ == "__main__":
    # Run the MCP server
    mcp.run()
