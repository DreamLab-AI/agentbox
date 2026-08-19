#!/usr/bin/env python3
"""
Podcast Bulk Ingest — backfill markdown transcript files for a YouTube series.

Downloads transcripts, show notes, and links for all episodes in a date range.
Optionally runs source extraction and enrichment (URL resolution, asset download).

Usage:
    python bulk_ingest.py <channel_or_playlist_url> [--months N] [--output-dir path]
                          [--enrich] [--assets] [--date-start YYYYMMDD] [--date-end YYYYMMDD]
"""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import unquote

INGEST_STATUS_DOWNLOADED = "ingest-status:: downloaded"
INGEST_STATUS_PREFIX = "ingest-status::"


# ---------------------------------------------------------------------------
# Slug / utility
# ---------------------------------------------------------------------------

def slugify(title: str, max_len: int = 80) -> str:
    s = title.lower().strip()
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s_]+', '-', s)
    s = re.sub(r'-+', '-', s).strip('-')
    return s[:max_len]


def load_state(state_path: Path) -> dict:
    if state_path.exists():
        return json.loads(state_path.read_text())
    return {}


def save_state(state_path: Path, state: dict):
    state_path.write_text(json.dumps(state, indent=2))


# ---------------------------------------------------------------------------
# Phase 1: Download
# ---------------------------------------------------------------------------

def get_video_ids(channel_url: str) -> list[tuple[str, str]]:
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
                    idx: int, total: int) -> tuple[str, Path | None]:
    slug = slugify(title)
    md_path = out_dir / f"{slug}.md"

    if md_path.exists() and md_path.stat().st_size > 500:
        return "SKIP", md_path

    url = f"https://www.youtube.com/watch?v={vid_id}"
    meta_cmd = [sys.executable, "-m", "yt_dlp", "--skip-download", "--dump-json", url]
    meta_result = subprocess.run(meta_cmd, capture_output=True, text=True, timeout=90)
    if meta_result.returncode != 0:
        print(f"[{idx}/{total}] FAIL metadata: {title}", flush=True)
        return "FAIL", None

    try:
        info = json.loads(meta_result.stdout)
    except json.JSONDecodeError:
        print(f"[{idx}/{total}] FAIL JSON: {title}", flush=True)
        return "FAIL", None

    upload_date = info.get("upload_date", "unknown")
    if upload_date != "unknown":
        if cutoff_end and upload_date > cutoff_end:
            return "NEWER", None
        if cutoff_start and upload_date < cutoff_start:
            return "OLD", None

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

    # Build markdown with ingest-status marker on line 1
    md = f"{INGEST_STATUS_DOWNLOADED}\n"
    md += f"# {title}\n\n"
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
    return "OK", md_path


def run_download(args, out_dir: Path, state: dict) -> int:
    channel_url = args.channel
    if channel_url.startswith('@'):
        channel_url = f"https://www.youtube.com/{channel_url}/videos"
    elif '/videos' not in channel_url and 'playlist' not in channel_url:
        channel_url = channel_url.rstrip('/') + '/videos'

    now = datetime.now()
    cutoff_start = args.date_start or (now - timedelta(days=args.months * 30)).strftime("%Y%m%d")
    cutoff_end = args.date_end or now.strftime("%Y%m%d")

    print(f"Channel: {channel_url}", flush=True)
    print(f"Date window: {cutoff_start} to {cutoff_end}", flush=True)
    print(f"Output: {out_dir}\n", flush=True)

    # Existing video IDs from both state file and markdown files
    existing_ids = set(state.keys())
    for f in out_dir.glob("*.md"):
        text = f.read_text()[:500]
        m = re.search(r'watch\?v=([A-Za-z0-9_-]+)', text)
        if m:
            existing_ids.add(m.group(1))

    print(f"Already have {len(existing_ids)} episodes.", flush=True)
    print("Fetching video list...", flush=True)
    all_videos = get_video_ids(channel_url)
    print(f"Found {len(all_videos)} total videos.\n", flush=True)

    videos = [(vid, title) for vid, title in all_videos if vid not in existing_ids]
    done = 0
    old_streak = 0
    max_eps = args.max_episodes or len(videos)

    for i, (vid_id, title) in enumerate(videos, 1):
        if done >= max_eps:
            print(f"Reached max-episodes cap ({max_eps}).", flush=True)
            break
        try:
            result, md_path = download_single(vid_id, title, out_dir, cutoff_start, cutoff_end, i, len(videos))
            if result == "OK":
                done += 1
                old_streak = 0
                state[vid_id] = {"status": "downloaded", "file": md_path.name, "date": datetime.now().isoformat()}
            elif result == "OLD":
                old_streak += 1
                if old_streak >= args.old_streak:
                    print(f"{args.old_streak} consecutive old episodes — past target window.", flush=True)
                    break
            elif result in ("NEWER", "SKIP"):
                old_streak = 0
                if result == "SKIP":
                    state[vid_id] = state.get(vid_id, {"status": "downloaded", "file": slugify(title) + ".md"})
        except Exception as e:
            print(f"  ERROR: {e}", flush=True)

    total_files = len(list(out_dir.glob("*.md")))
    print(f"\nDownload done! {done} new episodes. Total: {total_files}", flush=True)
    return done


# ---------------------------------------------------------------------------
# Phase 2: Source extraction
# ---------------------------------------------------------------------------

PUBLICATIONS = [
    "Bloomberg", "Financial Times", "The New York Times", "New York Times", "NYT",
    "Wall Street Journal", "WSJ", "Reuters", "The Information", "The Verge",
    "TechCrunch", "Wired", "Ars Technica", "MIT Technology Review", "Nature",
    "Science", "ArXiv", "The Economist", "Forbes", "Fortune", "CNBC",
    "Washington Post", "Politico", "Axios", "Semafor", "404 Media",
    "The Atlantic", "Vox", "Business Insider", "Insider", "Fast Company",
    "Hacker News", "SemiAnalysis", "China Talk", "Brookings", "RAND",
]

RESEARCH_FIRMS = [
    "McKinsey", "Deloitte", "BCG", "Boston Consulting", "PwC", "KPMG",
    "Accenture", "Gartner", "Forrester", "IDC", "Bain", "Goldman Sachs",
    "Morgan Stanley", "JP Morgan", "Bank of America", "Bernstein",
    "Stanford", "MIT", "Harvard", "Oxford", "Cambridge", "Berkeley",
    "Carnegie Mellon", "Google DeepMind", "DeepMind",
]

AI_COMPANIES = [
    "OpenAI", "Anthropic", "Google", "Meta", "Microsoft", "Amazon", "Apple",
    "Nvidia", "xAI", "Mistral", "Cohere", "Stability", "Midjourney",
    "Hugging Face", "Databricks", "Snowflake", "Scale AI", "Anysphere",
    "Cursor", "Cognition", "Devin", "Perplexity", "Character AI",
    "Inflection", "Adept", "Runway", "ElevenLabs", "Suno",
    "ByteDance", "Alibaba", "Tencent", "Baidu", "Moonshot", "DeepSeek",
    "Zhipu", "01.AI",
]

FALSE_POSITIVES = {"he", "she", "they", "it", "we", "i", "who", "that", "this", "when he"}


def extract_sources(transcript: str, title: str) -> list[dict]:
    sources = []
    sentences = re.split(r'[.!?]+', transcript)

    for sent in sentences:
        sent = sent.strip()
        if len(sent) < 20:
            continue

        for pub in PUBLICATIONS:
            patterns = [
                rf'{pub}\s+(?:reports?|reported|reporting|wrote|writes|says?|said|notes?|noted|found|reveals?|revealed)',
                rf'(?:according to|per|via|from|in)\s+(?:a\s+)?(?:new\s+)?{pub}',
                rf'{pub}\s+(?:article|piece|story|report|analysis|investigation|interview|survey|study)',
            ]
            for pattern in patterns:
                if re.search(pattern, sent, re.IGNORECASE):
                    sources.append({"source": pub, "type": "article", "context": sent[:300], "episode": title})
                    break

        for firm in RESEARCH_FIRMS:
            patterns = [
                rf'{firm}\s+(?:report|study|survey|research|analysis|paper|found|estimates?|projects?)',
                rf'(?:according to|per|from)\s+{firm}',
                rf'(?:new|latest|recent)\s+{firm}\s+(?:report|study|survey)',
            ]
            for pattern in patterns:
                if re.search(pattern, sent, re.IGNORECASE):
                    sources.append({"source": firm, "type": "report", "context": sent[:300], "episode": title})
                    break

        for company in AI_COMPANIES:
            patterns = [
                rf'{company}\s+(?:announced|released|launched|published|unveiled|introduced|posted|wrote|shared|blogged)',
                rf'{company}(?:\'s|s)?\s+(?:blog|post|announcement|press release|paper|system card|safety report)',
            ]
            for pattern in patterns:
                if re.search(pattern, sent, re.IGNORECASE):
                    sources.append({"source": company, "type": "announcement", "context": sent[:300], "episode": title})
                    break

        quote_pattern = r'(\w+(?:\s\w+)?)\s+(?:wrote|said|posted|tweeted|noted|added|argued|suggested|responded|commented),?\s*[""“](.{20,200}?)[""”]'
        for m in re.finditer(quote_pattern, sent, re.IGNORECASE):
            sources.append({"source": m.group(1).strip(), "type": "quote", "context": m.group(2)[:200], "episode": title})

        for pattern in [r'(?:on X|on Twitter|posted on X|tweeted)', r'@\w+\s+(?:wrote|said|posted|noted)']:
            if re.search(pattern, sent, re.IGNORECASE):
                name_match = re.search(r'(\w+(?:\s\w+)?)\s+(?:posted on X|tweeted|wrote on X)', sent, re.IGNORECASE)
                sources.append({
                    "source": name_match.group(1) if name_match else "X post",
                    "type": "social", "context": sent[:300], "episode": title,
                })
                break

    seen = set()
    deduped = []
    for s in sources:
        key = (s["source"].lower(), s["type"])
        if key not in seen and s["source"].lower() not in FALSE_POSITIVES:
            seen.add(key)
            deduped.append(s)
    return deduped


def run_extraction(out_dir: Path):
    enrichment_dir = out_dir / ".enrichment"
    enrichment_dir.mkdir(exist_ok=True)

    md_files = sorted(out_dir.glob("*.md"))
    print(f"\nExtracting sources from {len(md_files)} files...", flush=True)

    all_sources = []
    episodes_with_sources = 0

    for i, md_path in enumerate(md_files, 1):
        content = md_path.read_text()
        title_match = re.search(r'^# (.+)', content, re.MULTILINE)
        title = title_match.group(1) if title_match else md_path.stem

        transcript_match = re.search(r'## Transcript\n\n(.+)', content, re.DOTALL)
        if not transcript_match:
            continue
        transcript = transcript_match.group(1)
        if transcript.startswith("_Transcript not available"):
            continue

        sources = extract_sources(transcript, title)
        if sources:
            episodes_with_sources += 1
            all_sources.extend(sources)
            ep_path = enrichment_dir / f"{md_path.stem}.json"
            ep_path.write_text(json.dumps({"episode": title, "file": md_path.name, "sources": sources}, indent=2))

        if i % 20 == 0:
            print(f"  [{i}/{len(md_files)}] {len(all_sources)} sources found", flush=True)

    # Write summary and flat list
    summary = {
        "total_episodes": len(md_files),
        "episodes_with_sources": episodes_with_sources,
        "total_sources": len(all_sources),
    }
    (enrichment_dir / "extraction_summary.json").write_text(json.dumps(summary, indent=2))
    (enrichment_dir / "all_sources.json").write_text(json.dumps(all_sources, indent=2))

    # Deduplicated unique sources
    unique = {}
    for s in all_sources:
        key = f"{s['source']}|{s['type']}"
        if key not in unique:
            unique[key] = {"source": s["source"], "type": s["type"], "contexts": [s["context"]], "episodes": [s["episode"]]}
        else:
            if s["context"] not in unique[key]["contexts"]:
                unique[key]["contexts"].append(s["context"])
            if s["episode"] not in unique[key]["episodes"]:
                unique[key]["episodes"].append(s["episode"])

    unique_list = sorted(unique.values(), key=lambda x: -len(x["episodes"]))
    (enrichment_dir / "unique_sources.json").write_text(json.dumps(unique_list, indent=2))

    print(f"\nExtraction done! {episodes_with_sources} episodes, {len(all_sources)} sources, {len(unique_list)} unique.", flush=True)


# ---------------------------------------------------------------------------
# Phase 3: Apply enrichment tables to markdown files
# ---------------------------------------------------------------------------

def run_apply_enrichment(out_dir: Path):
    enrichment_dir = out_dir / ".enrichment"
    assets_dir = out_dir / "assets"

    # Load resolved URLs if they exist
    resolved_urls = {}
    resolved_path = enrichment_dir / "resolved_urls.json"
    if resolved_path.exists():
        for item in json.loads(resolved_path.read_text()):
            source_key = item.get("source", "").lower()
            if source_key not in resolved_urls or item.get("confidence") == "high":
                resolved_urls[source_key] = item

    # Load assets
    assets = {}
    if assets_dir.exists():
        for f in assets_dir.iterdir():
            if f.is_file() and f.suffix in ('.pdf', '.html'):
                assets[f.stem.lower()] = f.name

    # Load per-episode extraction data
    extraction_data = {}
    for f in enrichment_dir.glob("*.json"):
        if f.name in ("extraction_summary.json", "all_sources.json", "unique_sources.json",
                       "crosscheck_results.json", "resolved_urls.json"):
            continue
        data = json.loads(f.read_text())
        if data.get("file"):
            extraction_data[data["file"]] = data

    md_files = sorted(out_dir.glob("*.md"))
    updated = 0

    for md_path in md_files:
        sources = []
        if md_path.name in extraction_data:
            sources = extraction_data[md_path.name].get("sources", [])

        if not sources:
            continue

        # Build table
        rows = []
        seen = set()
        for s in sources:
            source = s.get("source", "unknown")
            stype = s.get("type", "unknown")
            context = s.get("context", "")[:150].replace("|", "—").replace("\n", " ").strip()
            key = source.lower()
            if key in seen or key in FALSE_POSITIVES:
                continue
            seen.add(key)

            url_col = ""
            if source.lower() in resolved_urls:
                url_col = f"[link]({resolved_urls[source.lower()].get('url', '')})"
            for asset_key, asset_file in assets.items():
                if source.lower().replace(" ", "-") in asset_key or \
                   any(word in asset_key for word in source.lower().split() if len(word) > 4):
                    url_col = f"[local](assets/{asset_file})"
                    break

            rows.append(f"| {source} | {stype} | {context} | {url_col} |")

        if not rows:
            continue

        table = "## Sources Mentioned\n\n"
        table += "| Source | Type | Context | URL |\n"
        table += "|--------|------|---------|-----|\n"
        table += "\n".join(rows) + "\n"

        content = md_path.read_text()
        content = re.sub(r'## Sources Mentioned\n.*?(?=## Transcript|$)', '', content, flags=re.DOTALL)
        if "## Transcript" in content:
            content = content.replace("## Transcript", table + "\n## Transcript")
        else:
            content += "\n" + table

        md_path.write_text(content)
        updated += 1

    print(f"\nEnrichment applied to {updated} files.", flush=True)


# ---------------------------------------------------------------------------
# Phase 4: Mark existing files that lack ingest-status
# ---------------------------------------------------------------------------

def run_mark_files(out_dir: Path):
    md_files = sorted(out_dir.glob("*.md"))
    marked = 0
    for md_path in md_files:
        content = md_path.read_text()
        if content.startswith(INGEST_STATUS_PREFIX):
            continue
        md_path.write_text(f"{INGEST_STATUS_DOWNLOADED}\n{content}")
        marked += 1
    print(f"Marked {marked} files with ingest-status.", flush=True)


# ---------------------------------------------------------------------------
# Phase 5: New domain detection + OntoCast bootstrapping
# ---------------------------------------------------------------------------

def extract_key_terms(out_dir: Path, sample_count: int = 5) -> list[str]:
    """Extract key terms from a sample of transcripts using word frequency."""
    md_files = sorted(out_dir.glob("*.md"))
    if not md_files:
        return []

    import random
    sample = random.sample(md_files, min(sample_count, len(md_files)))

    # Combine transcripts
    combined = []
    for f in sample:
        content = f.read_text()
        match = re.search(r'## Transcript\n\n(.+)', content, re.DOTALL)
        if match:
            combined.append(match.group(1)[:3000])

    text = ' '.join(combined).lower()

    # Extract capitalised multi-word terms (likely proper nouns / concepts)
    original_text = ' '.join(
        re.search(r'## Transcript\n\n(.+)', f.read_text(), re.DOTALL).group(1)[:3000]
        for f in sample
        if re.search(r'## Transcript\n\n(.+)', f.read_text(), re.DOTALL)
    )
    term_pattern = r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b'
    raw_terms = re.findall(term_pattern, original_text)

    # Count and rank
    from collections import Counter
    counts = Counter(raw_terms)

    # Filter out common non-domain phrases
    stopterms = {"United States", "New York", "Last Week", "This Week", "Thank You",
                 "One Thing", "Right Now", "First Time", "Real Time", "Let Me",
                 "Long Time", "At This", "At That", "In Fact", "Of Course"}
    terms = [(t, c) for t, c in counts.most_common(50) if t not in stopterms and c >= 2]
    return [t for t, _ in terms[:30]]


def probe_ontology_coverage(terms: list[str], ontology_dir: Path) -> dict:
    """Check how many terms have matching ontology pages."""
    if not ontology_dir or not ontology_dir.exists():
        return {"total": len(terms), "matched": 0, "coverage": 0.0, "unmatched": terms}

    matched = []
    unmatched = []
    for term in terms:
        found = False
        for variant in [term, term.replace(" ", "-"), term.replace(" ", " "),
                        term.title(), term.lower().replace(" ", "-")]:
            candidate = ontology_dir / f"{variant}.md"
            if candidate.exists():
                matched.append(term)
                found = True
                break
        if not found:
            unmatched.append(term)

    coverage = len(matched) / len(terms) if terms else 0.0
    return {
        "total": len(terms),
        "matched": len(matched),
        "matched_terms": matched,
        "unmatched": unmatched,
        "coverage": coverage,
    }


def run_domain_probe(out_dir: Path, ontology_dir: Path | None = None) -> dict:
    """Probe whether this podcast covers a domain already in the ontology."""
    print("\n--- Domain coverage probe ---", flush=True)
    terms = extract_key_terms(out_dir)
    if not terms:
        print("  No key terms extracted from transcripts.", flush=True)
        return {"coverage": 1.0}

    print(f"  Extracted {len(terms)} key terms from sample.", flush=True)

    if ontology_dir:
        probe = probe_ontology_coverage(terms, ontology_dir)
    else:
        probe = {"total": len(terms), "matched": 0, "coverage": 0.0, "unmatched": terms}

    pct = probe["coverage"] * 100
    print(f"  Ontology coverage: {probe['matched']}/{probe['total']} terms ({pct:.0f}%)", flush=True)

    if probe["coverage"] < 0.3:
        print(f"\n  ⚠ LOW COVERAGE — this podcast likely covers a domain not yet in the ontology.", flush=True)
        print(f"  Unmatched terms: {', '.join(probe['unmatched'][:15])}", flush=True)
        print(f"\n  RECOMMENDATION: Use OntoCast to bootstrap ontology pages for this domain.", flush=True)
        print(f"  See: agentbox/skills/podcast-bulk-ingest/SKILL.md § 'New domain detection'", flush=True)
        print(f"\n  To bootstrap with OntoCast:", flush=True)
        print(f"    1. Install: pip install 'ontocast[server,openai]'", flush=True)
        print(f"    2. Configure LLM backend (Loom or external):", flush=True)
        print(f"       export LLM_PROVIDER=openai_compatible", flush=True)
        print(f"       export LLM_BASE_URL=http://192.168.2.132:8084/v1", flush=True)
        print(f"       export LLM_API_KEY=not-needed", flush=True)
        print(f"       export LLM_MODEL_NAME=qwen3.8-27b", flush=True)
        print(f"    3. Run OntoCast on a sample transcript:", flush=True)
        print(f"       ontocast process --input-path sample.txt --output-dir ./ontocast-out", flush=True)
        print(f"    4. Stage candidates via the knowledgeGraph pipeline:", flush=True)
        print(f"       python -m pipeline.ontocast_import ontocast-out/ontology.ttl \\", flush=True)
        print(f"         --output-dir review/podcast-bootstrap \\", flush=True)
        print(f"         --project-token ngm --domain [DOMAIN] \\", flush=True)
        print(f"         --source-document 'podcast:bootstrap' \\", flush=True)
        print(f"         --default-parent-iri urn:ngm:class/[domain-root] \\", flush=True)
        print(f"         --default-parent-label '[Domain Root]'", flush=True)
        print(f"    5. Review candidates, promote to mainKnowledgeGraph/pages/", flush=True)
        print(f"    6. Re-run this ingest — weekly cron will now enrich the new pages.", flush=True)
    elif probe["coverage"] < 0.6:
        print(f"\n  ℹ PARTIAL COVERAGE — some new concepts may need ontology pages.", flush=True)
        print(f"  Consider adding pages for: {', '.join(probe['unmatched'][:10])}", flush=True)
    else:
        print(f"\n  ✓ Good ontology coverage for this domain.", flush=True)

    return probe


def generate_ontocast_sample(out_dir: Path, sample_count: int = 5) -> Path | None:
    """Concatenate sample transcripts into a single text file for OntoCast input."""
    md_files = sorted(out_dir.glob("*.md"))
    if not md_files:
        return None

    import random
    sample = random.sample(md_files, min(sample_count, len(md_files)))

    sample_path = out_dir / ".ontocast-sample.txt"
    parts = []
    for f in sample:
        content = f.read_text()
        title_match = re.search(r'^# (.+)', content, re.MULTILINE)
        title = title_match.group(1) if title_match else f.stem
        transcript_match = re.search(r'## Transcript\n\n(.+)', content, re.DOTALL)
        if transcript_match:
            parts.append(f"=== {title} ===\n\n{transcript_match.group(1)[:5000]}\n\n")

    if not parts:
        return None

    sample_path.write_text('\n'.join(parts))
    print(f"\n  OntoCast sample written to: {sample_path}", flush=True)
    print(f"  Contains {len(parts)} episode excerpts.", flush=True)
    return sample_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Podcast Bulk Ingest")
    parser.add_argument("channel", help="YouTube channel URL, @handle, or playlist URL")
    parser.add_argument("--months", type=int, default=6, help="Months of history (default: 6)")
    parser.add_argument("--output-dir", default="./transcripts", help="Output directory")
    parser.add_argument("--date-start", help="Override start date (YYYYMMDD)")
    parser.add_argument("--date-end", help="Override end date (YYYYMMDD)")
    parser.add_argument("--enrich", action="store_true", help="Run source extraction + enrichment")
    parser.add_argument("--assets", action="store_true", help="Download referenced reports (requires agent)")
    parser.add_argument("--max-episodes", type=int, help="Cap number of episodes")
    parser.add_argument("--old-streak", type=int, default=15, help="Consecutive old episodes before exit")
    parser.add_argument("--ontology-dir", type=Path, help="Ontology pages directory for domain probe")
    parser.add_argument("--domain-probe", action="store_true", help="Probe ontology coverage and suggest OntoCast")
    parser.add_argument("--generate-ontocast-sample", action="store_true",
                        help="Generate a sample text file for OntoCast input")
    args = parser.parse_args()

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    state_path = out_dir / ".ingest-state.json"
    state = load_state(state_path)

    downloaded = run_download(args, out_dir, state)
    save_state(state_path, state)

    if args.enrich:
        run_extraction(out_dir)
        run_apply_enrichment(out_dir)

    run_mark_files(out_dir)

    # Domain probe — check if this podcast's domain is in the ontology
    if args.domain_probe or args.generate_ontocast_sample:
        probe = run_domain_probe(out_dir, args.ontology_dir)
        if args.generate_ontocast_sample and probe.get("coverage", 1.0) < 0.6:
            generate_ontocast_sample(out_dir)

    total = len(list(out_dir.glob("*.md")))
    print(f"\nBulk ingest complete. {total} total episodes in {out_dir}", flush=True)


if __name__ == "__main__":
    main()
