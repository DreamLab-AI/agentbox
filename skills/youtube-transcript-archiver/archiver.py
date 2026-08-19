#!/usr/bin/env python3
"""
YouTube Transcript Archiver — reusable core for any YouTube channel/playlist.

Usage:
    python archiver.py <channel_or_playlist_url> [--months N] [--output-dir path]

Produces one markdown file per episode with title, date, duration, YouTube link,
show notes, extracted links, and full auto-generated transcript.
"""

import argparse
import subprocess
import json
import sys
import re
import os
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import unquote


def slugify(title: str, max_len: int = 80) -> str:
    s = title.lower().strip()
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s_]+', '-', s)
    s = re.sub(r'-+', '-', s).strip('-')
    return s[:max_len]


def get_video_ids(channel_url: str) -> list[tuple[str, str]]:
    """Fetch all video IDs and titles from a channel or playlist (newest first)."""
    cmd = [sys.executable, "-m", "yt_dlp", "--flat-playlist",
           "--print", "%(id)s\t%(title)s", channel_url]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    videos = []
    for line in result.stdout.strip().split('\n'):
        if '\t' in line:
            vid_id, title = line.split('\t', 1)
            videos.append((vid_id, title))
    return videos


def download_single(vid_id: str, title: str, out_dir: Path,
                    cutoff_start: str, cutoff_end: str,
                    idx: int, total: int) -> str:
    """Download transcript and metadata for a single video. Returns status string."""
    slug = slugify(title)
    md_path = out_dir / f"{slug}.md"

    if md_path.exists() and md_path.stat().st_size > 500:
        return "SKIP"

    url = f"https://www.youtube.com/watch?v={vid_id}"

    meta_cmd = [sys.executable, "-m", "yt_dlp", "--skip-download", "--dump-json", url]
    meta_result = subprocess.run(meta_cmd, capture_output=True, text=True, timeout=90)
    if meta_result.returncode != 0:
        print(f"[{idx}/{total}] FAIL metadata: {title}", flush=True)
        return "FAIL"

    try:
        info = json.loads(meta_result.stdout)
    except json.JSONDecodeError:
        print(f"[{idx}/{total}] FAIL JSON: {title}", flush=True)
        return "FAIL"

    upload_date = info.get("upload_date", "unknown")
    if upload_date != "unknown":
        if cutoff_end and upload_date > cutoff_end:
            return "NEWER"
        if cutoff_start and upload_date < cutoff_start:
            return "OLD"

    formatted_date = (f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:]}"
                      if len(upload_date) == 8 else upload_date)
    duration = info.get("duration_string", "unknown")
    description = info.get("description", "")

    print(f"[{idx}/{total}] {title} ({formatted_date})", flush=True)

    links = re.findall(r'https?://[^\s<>"\']+', description)

    # Download auto-generated subtitles
    sub_dir = out_dir / ".subs_tmp"
    sub_dir.mkdir(exist_ok=True)
    sub_cmd = [sys.executable, "-m", "yt_dlp", "--skip-download",
               "--write-auto-sub", "--sub-lang", "en", "--sub-format", "vtt",
               "--convert-subs", "srt", "-o", str(sub_dir / vid_id), url]
    subprocess.run(sub_cmd, capture_output=True, text=True, timeout=120)

    transcript_text = ""
    for ext in [".en.srt", ".en.vtt"]:
        sub_file = sub_dir / (vid_id + ext)
        if sub_file.exists():
            raw = sub_file.read_text()
            lines = []
            for line in raw.split('\n'):
                line = line.strip()
                if not line:
                    continue
                if re.match(r'^\d+$', line):
                    continue
                if re.match(r'\d{2}:\d{2}:\d{2}', line):
                    continue
                if line.startswith(('WEBVTT', 'Kind:', 'Language:')):
                    continue
                line = re.sub(r'<[^>]+>', '', line)
                if line and line not in lines[-1:]:
                    lines.append(line)
            transcript_text = ' '.join(lines)
            sub_file.unlink()
            break

    # Build markdown
    md = f"# {title}\n\n"
    md += f"- **Date**: {formatted_date}\n"
    md += f"- **Duration**: {duration}\n"
    md += f"- **YouTube**: https://www.youtube.com/watch?v={vid_id}\n\n"
    md += f"## Show Notes\n\n{description}\n\n## Links\n\n"

    for link in links:
        if 'redirect' in link and 'q=' in link:
            match = re.search(r'q=(https?[^&]+)', link)
            if match:
                link = unquote(match.group(1))
        md += f"- {link}\n"

    if not links:
        md += "_No links found in show notes._\n"

    md += f"\n## Transcript\n\n"
    if transcript_text:
        words = transcript_text.split()
        para = []
        for i, w in enumerate(words):
            para.append(w)
            if (i + 1) % 500 == 0:
                md += ' '.join(para) + '\n\n'
                para = []
        if para:
            md += ' '.join(para) + '\n'
    else:
        md += "_Transcript not available for this episode._\n"

    md_path.write_text(md)
    print(f"  -> {md_path.name} ({len(transcript_text)} chars)", flush=True)
    return "OK"


def main():
    parser = argparse.ArgumentParser(description="YouTube Transcript Archiver")
    parser.add_argument("channel", help="YouTube channel URL, @handle, or playlist URL")
    parser.add_argument("--months", type=int, default=6, help="Months of history to archive")
    parser.add_argument("--output-dir", default="./transcripts", help="Output directory")
    parser.add_argument("--date-start", help="Override start date (YYYYMMDD)")
    parser.add_argument("--date-end", help="Override end date (YYYYMMDD)")
    args = parser.parse_args()

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Calculate date window
    now = datetime.now()
    cutoff_start = args.date_start or (now - timedelta(days=args.months * 30)).strftime("%Y%m%d")
    cutoff_end = args.date_end or now.strftime("%Y%m%d")

    # Normalise channel URL
    channel_url = args.channel
    if channel_url.startswith('@'):
        channel_url = f"https://www.youtube.com/{channel_url}/videos"
    elif '/videos' not in channel_url and 'playlist' not in channel_url:
        channel_url = channel_url.rstrip('/') + '/videos'

    print(f"Channel: {channel_url}", flush=True)
    print(f"Date window: {cutoff_start} to {cutoff_end}", flush=True)
    print(f"Output: {out_dir}\n", flush=True)

    # Get existing video IDs
    existing_ids = set()
    for f in out_dir.glob("*.md"):
        text = f.read_text()[:500]
        m = re.search(r'watch\?v=([A-Za-z0-9_-]+)', text)
        if m:
            existing_ids.add(m.group(1))
    print(f"Already have {len(existing_ids)} episodes.\n", flush=True)

    # Fetch video list
    print("Fetching video list...", flush=True)
    all_videos = get_video_ids(channel_url)
    print(f"Found {len(all_videos)} total videos.\n", flush=True)

    # Filter to not-yet-downloaded
    videos = [(vid, title) for vid, title in all_videos if vid not in existing_ids]

    done = 0
    old_streak = 0
    for i, (vid_id, title) in enumerate(videos, 1):
        try:
            result = download_single(vid_id, title, out_dir, cutoff_start, cutoff_end, i, len(videos))
            if result == "OK":
                done += 1
                old_streak = 0
            elif result == "OLD":
                old_streak += 1
                if old_streak >= 15:
                    print("15 consecutive old episodes — past target window.", flush=True)
                    break
            elif result in ("NEWER", "SKIP"):
                old_streak = 0
        except Exception as e:
            print(f"  ERROR: {e}", flush=True)

    total_files = len(list(out_dir.glob("*.md")))
    print(f"\nDone! Downloaded {done} new episodes. Total: {total_files}", flush=True)


if __name__ == "__main__":
    main()
