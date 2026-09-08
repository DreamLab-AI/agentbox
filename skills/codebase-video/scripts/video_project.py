#!/usr/bin/env python3
"""Grounded video manifest validation and deterministic FFmpeg delivery; stdlib only."""
import argparse
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import textwrap


def run(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, capture_output=True, text=True, **kwargs)


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def probe(path):
    return json.loads(run(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', path]).stdout)


def duration(path):
    return float(probe(path)['format']['duration'])


def asset_path(base, value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('asset path must be a non-empty string')
    path = (base / value).resolve()
    if not path.is_file():
        raise ValueError(f'missing asset: {path}')
    return path


def validate(plan, base, delivery=False):
    if not isinstance(plan, dict):
        raise ValueError('plan must be a JSON object')
    if plan.get('schema_version') != 1:
        raise ValueError('schema_version must be 1')
    for field in ('title', 'audience', 'repo_root'):
        if not isinstance(plan.get(field), str) or not plan[field].strip():
            raise ValueError(f'{field} is required')
    root = (base / plan['repo_root']).resolve()
    if not root.is_dir():
        raise ValueError('repo_root must exist')
    for field, low, high in (('width', 160, 3840), ('height', 90, 3840), ('fps', 1, 60)):
        n = plan.get(field)
        if type(n) is not int or not low <= n <= high or (field != 'fps' and n % 2):
            raise ValueError(f'invalid {field}; dimensions must be even')
    if plan.get('font_file'):
        asset_path(base, plan['font_file'])
    scenes = plan.get('scenes')
    if not isinstance(scenes, list) or not scenes:
        raise ValueError('at least one scene is required')
    ids = set()
    for scene in scenes:
        if not isinstance(scene, dict):
            raise ValueError('each scene must be a JSON object')
        ident = scene.get('id', '')
        if not isinstance(ident, str) or not re.fullmatch(r'[a-z0-9_-]+', ident) or ident in ids:
            raise ValueError('scene ids must be unique lowercase identifiers')
        ids.add(ident)
        seconds = scene.get('duration')
        if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or not 0 < seconds <= 300:
            raise ValueError(f'{ident}: duration must be finite and between 0 and 300')
        kind = scene.get('kind')
        if kind not in ('title', 'diagram', 'image', 'video'):
            raise ValueError(f'{ident}: unsupported scene kind')
        for field in ('title', 'narration'):
            if not isinstance(scene.get(field), str) or not scene[field].strip():
                raise ValueError(f'{ident}: {field} is required')
        if kind in ('image', 'video'):
            asset_path(base, scene.get('asset'))
        if kind == 'diagram':
            nodes = scene.get('nodes')
            if not isinstance(nodes, list) or not 2 <= len(nodes) <= 4 or any(not isinstance(n, str) or not n.strip() or len(n) > 45 for n in nodes):
                raise ValueError(f'{ident}: diagram needs 2–4 labels, each at most 45 characters')
        evidence = scene.get('evidence')
        if not isinstance(evidence, list) or not evidence:
            raise ValueError(f'{ident}: source evidence is required')
        for ref in evidence:
            if not isinstance(ref, str):
                raise ValueError('evidence must contain repo-relative file paths')
            target = (root / ref).resolve()
            if not target.is_relative_to(root) or not target.is_file():
                raise ValueError(f'{ident}: invalid source evidence: {ref}')
        if scene.get('audio'):
            audio = asset_path(base, scene['audio'])
            info = probe(audio)
            if not any(s['codec_type'] == 'audio' for s in info['streams']):
                raise ValueError(f'{ident}: narration file has no audio stream')
            if float(info['format']['duration']) > seconds + 0.001:
                raise ValueError(f'{ident}: narration exceeds scene duration; retime the scene')
        elif delivery:
            raise ValueError(f'{ident}: delivery requires narration audio (use --preview for silent drafts)')
        if len(overlay_lines(plan, scene['title'], 'title')) > 2:
            raise ValueError(f'{ident}: title exceeds two lines; shorten the title')
        if scene.get('caption') and (not isinstance(scene['caption'], str) or len(overlay_lines(plan, scene['caption'], 'caption')) > 2):
            raise ValueError(f'{ident}: on-screen caption must fit two lines')
        cue_groups = caption_groups(scene['narration'])
        minimum = sum(max(1.0, len(group.replace(chr(10), ' ')) / 25) for group in cue_groups)
        if seconds + 1e-8 < minimum:
            raise ValueError(f'{ident}: narration captions need at least {minimum:.2f}s for readability; retime the scene')
        if scene.get('role') == 'hero' and (kind != 'video' or 'generation' not in scene):
            raise ValueError(f'{ident}: generated hero needs video plus model, workflow and prompt_id')
        if 'generation' in scene:
            provenance = scene['generation']
            if not isinstance(provenance, dict) or any(not isinstance(provenance.get(k), str) or not provenance[k].strip() for k in ('model', 'workflow', 'prompt_id')):
                raise ValueError(f'{ident}: generation needs model, workflow and prompt_id strings')
            asset_path(base, provenance['workflow'])
            if 'receipt' in provenance:
                asset_path(base, provenance['receipt'])
    return root


def stamp(seconds):
    ms = round(seconds * 1000)
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}'


def caption_groups(narration):
    lines = textwrap.wrap(' '.join(narration.split()), 42)
    return ['\n'.join(lines[i:i + 2]) for i in range(0, len(lines), 2)]


def captions(plan):
    chunks, offset, index = [], 0, 1
    for scene in plan['scenes']:
        # Scene-aligned phrase cues are deliberately not claimed as word alignment.
        groups = caption_groups(scene['narration'])
        minima = [max(1.0, len(group.replace('\n', ' ')) / 25) for group in groups]
        slack = max(0, scene['duration'] - sum(minima))
        lengths = [len(group) for group in groups]
        cursor = offset
        for group, minimum, length in zip(groups, minima, lengths):
            span = minimum + slack * length / sum(lengths)
            chunks.append(f'{index}\n{stamp(cursor)} --> {stamp(cursor + span)}\n{group}\n')
            cursor += span
            index += 1
        offset += scene['duration']
    return '\n'.join(chunks)


def overlay_size(plan, field):
    return max(14 if field == 'title' else 12, int(plan['height'] * (.048 if field == 'title' else .032)))


def overlay_lines(plan, text, field):
    # One em per character is deliberately conservative for proportional fonts.
    # Keep text plus its eight-pixel box inside a five-percent safe margin.
    available = plan['width'] - 2 * max(20, math.ceil(plan['width'] * .05))
    columns = max(1, int(available / overlay_size(plan, field)))
    return textwrap.wrap(text, columns)


def text_filter(work, name, text, size, x, y, extra=''):
    # Relative generated filenames keep shell/filter metacharacters out of filters.
    (work / name).write_text(text, encoding='utf-8')
    font = 'fontfile=font.ttf:' if (work / 'font.ttf').is_file() else ''
    return f'drawtext={font}textfile={name}:expansion=none:fontsize={size}:fontcolor=white:x={x}:y={y}' + extra


def scene_filter(plan, scene, work):
    w, h, fps = (plan[k] for k in ('width', 'height', 'fps'))
    filters = [f'scale={w}:{h}:force_original_aspect_ratio=decrease', f'pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=0x101827', 'setsar=1', f'fps={fps}']
    if scene['kind'] == 'image' and scene.get('motion', True):
        filters += [f"zoompan=z='min(zoom+0.0005,1.06)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s={w}x{h}:fps={fps}"]
    filters += [f'drawbox=x=0:y=0:w=iw:h={int(h*.19)}:color=0x101827@0.8:t=fill']
    title = '\n'.join(overlay_lines(plan, scene['title'], 'title'))
    filters += [text_filter(work, 'title.txt', title, overlay_size(plan, 'title'), '(w-tw)/2', str(int(h*.045)))]
    if scene['kind'] == 'diagram':
        nodes = scene['nodes']
        box_w, box_h = int(w*.72), int(h*.1)
        for i, label in enumerate(nodes):
            y = int(h*.24 + i*h*.145)
            start = i * scene['duration'] / (len(nodes) + 1)
            enable = f":enable='gte(t,{start})'"
            filters += [f'drawbox=x={(w-box_w)//2}:y={y}:w={box_w}:h={box_h}:color=0x245579:t=fill' + enable]
            filters += [text_filter(work, f'node{i}.txt', label, max(12, int(h*.035)), '(w-tw)/2', str(y+int(h*.025)), enable)]
            if i < len(nodes)-1:
                filters += [f'drawbox=x={w//2-2}:y={y+box_h}:w=4:h={int(h*.045)}:color=0x68d9d0:t=fill' + enable]
    if scene.get('caption'):
        caption = '\n'.join(overlay_lines(plan, scene['caption'], 'caption'))
        filters += [text_filter(work, 'caption.txt', caption, overlay_size(plan, 'caption'), '(w-tw)/2', 'h-th-20', ':box=1:boxcolor=black@0.7:boxborderw=8')]
    return ','.join(filters)


def compose(plan, base, output, preview=False):
    root = validate(plan, base, delivery=not preview)
    output = output.resolve()
    if output.exists():
        raise ValueError(f'output already exists: {output}; select a new delivery directory')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.video-', dir=output.parent) as temp:
        work = Path(temp)
        if plan.get('font_file'):
            shutil.copyfile(asset_path(base, plan['font_file']), work / 'font.ttf')
        segments = []
        for i, scene in enumerate(plan['scenes']):
            seconds = scene['duration']
            args = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '2', '-filter_threads', '1']
            if scene['kind'] == 'image':
                args += ['-loop', '1', '-i', asset_path(base, scene['asset'])]
            elif scene['kind'] == 'video':
                args += ['-i', asset_path(base, scene['asset'])]
            else:
                args += ['-f', 'lavfi', '-i', f"color=c=0x101827:s={plan['width']}x{plan['height']}:r={plan['fps']}"]
            if scene.get('audio'):
                args += ['-i', asset_path(base, scene['audio'])]
            else:
                args += ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
            filt = scene_filter(plan, scene, work)
            if scene['kind'] == 'video':
                filt += f',tpad=stop_mode=clone:stop_duration={seconds}'
            segment = f'segment-{i:04}.mp4'
            args += ['-map', '0:v:0', '-map', '1:a:0', '-vf', filt, '-af', 'apad,loudnorm=I=-16:TP=-1.5:LRA=11', '-t', str(seconds), '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', segment]
            run(args, cwd=work)
            segments.append(segment)
        (work / 'segments.txt').write_text(''.join(f"file '{s}'\n" for s in segments))
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '1', '-i', 'segments.txt', '-c', 'copy', '-movflags', '+faststart', 'video.mp4'], cwd=work)
        info = probe(work / 'video.mp4')
        expected = sum(s['duration'] for s in plan['scenes'])
        if abs(float(info['format']['duration']) - expected) > max(.5, len(segments) / plan['fps']):
            raise ValueError('render duration differs from plan')
        (work / 'captions.srt').write_text(captions(plan), encoding='utf-8')
        # Embed selectable captions while keeping an accessible sidecar transcript.
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', 'video.mp4', '-i', 'captions.srt', '-c', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng', '-movflags', '+faststart', 'explainer.mp4'], cwd=work)
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', '0', '-i', 'explainer.mp4', '-frames:v', '1', 'poster.jpg'], cwd=work)
        receipt = {'status': 'preview' if preview else 'rendered-needs-editorial-review', 'audience': plan['audience'], 'duration': float(info['format']['duration']), 'planned_duration': expected, 'probe': probe(work / 'explainer.mp4'), 'sources': {}, 'assets': {}, 'generation': []}
        for scene in plan['scenes']:
            for ref in scene['evidence']:
                receipt['sources'][ref] = sha256_file(root / ref)
            for field in ('asset', 'audio'):
                if scene.get(field):
                    path = asset_path(base, scene[field])
                    receipt['assets'][str(path)] = sha256_file(path)
            if 'generation' in scene:
                generation = copy.deepcopy(scene['generation'])
                generation['scene_id'] = scene['id']
                for field in ('workflow', 'receipt'):
                    if field in generation:
                        path = asset_path(base, generation[field])
                        generation[field] = str(path)
                        generation[field + '_sha256'] = sha256_file(path)
                        receipt['assets'][str(path)] = generation[field + '_sha256']
                if scene.get('asset'):
                    generation['asset_sha256'] = sha256_file(asset_path(base, scene['asset']))
                receipt['generation'].append(generation)
        receipt['video_sha256'] = sha256_file(work / 'explainer.mp4')
        (work / 'transcript.md').write_text(f"# {plan['title']}\n\nAudience: {plan['audience']}\n\n" + '\n\n'.join(s['narration'] for s in plan['scenes']) + '\n')
        delivery_plan = copy.deepcopy(plan)
        delivery_plan['repo_root'] = str(root)
        if plan.get('font_file'):
            delivery_plan['font_file'] = str(asset_path(base, plan['font_file']))
            receipt['assets'][delivery_plan['font_file']] = sha256_file(delivery_plan['font_file'])
        for scene in delivery_plan['scenes']:
            for field in ('asset', 'audio'):
                if scene.get(field):
                    scene[field] = str(asset_path(base, scene[field]))
            if scene.get('generation'):
                for field in ('workflow', 'receipt'):
                    if field in scene['generation']:
                        scene['generation'][field] = str(asset_path(base, scene['generation'][field]))
        (work / 'plan.json').write_text(json.dumps(delivery_plan, indent=2) + '\n')
        (work / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
        delivery = work / 'delivery'
        delivery.mkdir()
        for name in ('explainer.mp4', 'poster.jpg', 'captions.srt', 'transcript.md', 'receipt.json', 'plan.json'):
            shutil.move(work / name, delivery / name)
        os.replace(delivery, output)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('validate', 'compose'))
    parser.add_argument('plan', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--preview', action='store_true', help='allow missing narration; label result preview')
    args = parser.parse_args()
    try:
        plan = json.loads(args.plan.read_text())
        base = args.plan.resolve().parent
        if args.command == 'validate':
            validate(plan, base, delivery=not args.preview)
            print('Manifest and assets valid')
        else:
            if not args.output:
                parser.error('compose requires --output')
            receipt = compose(plan, base, args.output, args.preview)
            print(json.dumps({'output': str(args.output.resolve()), 'status': receipt['status'], 'duration': receipt['duration']}))
    except (ValueError, KeyError, TypeError, OSError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f'video_project: {exc}\n' + (exc.stderr[-3000:] if isinstance(exc, subprocess.CalledProcessError) and exc.stderr else ''))


if __name__ == '__main__':
    main()
