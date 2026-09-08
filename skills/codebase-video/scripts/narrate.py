#!/usr/bin/env python3
"""Generate local Kokoro speech and a new measured video plan (optional dependencies)."""
import argparse
import copy
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import tempfile

from video_project import caption_groups, sha256_file


def check_script(plan):
    if not isinstance(plan, dict):
        raise ValueError('plan must be a JSON object')
    if plan.get('schema_version') != 1 or not plan.get('repo_root') or type(plan.get('fps')) is not int or not 1 <= plan['fps'] <= 60:
        raise ValueError('plan needs schema_version 1, repo_root and fps between 1 and 60')
    if not isinstance(plan.get('scenes'), list) or not plan['scenes']:
        raise ValueError('plan needs scenes')
    ids = set()
    for scene in plan['scenes']:
        if not isinstance(scene, dict):
            raise ValueError('each scene must be a JSON object')
        ident = scene.get('id', '')
        if not isinstance(ident, str) or not re.fullmatch('[a-z0-9_-]+', ident) or ident in ids:
            raise ValueError('scene IDs must be unique lowercase identifiers')
        if not isinstance(scene.get('narration'), str) or not scene['narration'].strip():
            raise ValueError(f'{ident}: narration is required')
        ids.add(ident)


def retime(seconds, narration, fps, breathing):
    readable = sum(max(1.0, len(cue.replace('\n', ' ')) / 25) for cue in caption_groups(narration))
    return math.ceil(max(seconds + breathing, readable) * fps) / fps


def narrate(plan_path, output, model, voices, voice='af_sarah', lang='en-us', speed=1.0, breathing=.3):
    if not math.isfinite(speed) or not .5 <= speed <= 2:
        raise ValueError('speed must be between 0.5 and 2')
    if not math.isfinite(breathing) or not 0 <= breathing <= 3:
        raise ValueError('breathing interval must be between 0 and 3 seconds')
    plan_path, output = Path(plan_path).resolve(), Path(output).resolve()
    model, voices = Path(model).resolve(), Path(voices).resolve()
    if not model.is_file() or not voices.is_file():
        raise ValueError('explicit model and voices files must already exist')
    if output.exists():
        raise ValueError('output already exists; choose a new narration directory')
    plan = json.loads(plan_path.read_text())
    check_script(plan)
    try:
        import numpy as np
        import onnxruntime as rt
        import soundfile as sf
        from kokoro_onnx import Kokoro
    except ImportError as error:
        raise ValueError('Narration dependencies could not load. Install kokoro-onnx==0.6.1 and soundfile in the project venv; on Nix check the shared-library search path. Details: ' + str(error)) from error
    # CPU inference leaves the shared GPU available to ComfyUI and Blender.
    options = rt.SessionOptions()
    options.intra_op_num_threads = min(4, os.cpu_count() or 1)
    session = rt.InferenceSession(str(model), sess_options=options, providers=['CPUExecutionProvider'])
    engine = Kokoro.from_session(session, str(voices))
    result = copy.deepcopy(plan)
    base = plan_path.parent
    result['repo_root'] = str((base / plan['repo_root']).resolve())
    if result.get('font_file'):
        result['font_file'] = str((base / result['font_file']).resolve())
    output.parent.mkdir(parents=True, exist_ok=True)
    receipt = {'engine': 'kokoro-onnx', 'version': importlib.metadata.version('kokoro-onnx'), 'provider': 'CPUExecutionProvider', 'model': str(model), 'model_sha256': sha256_file(model), 'voices': str(voices), 'voices_sha256': sha256_file(voices), 'voice': voice, 'lang': lang, 'speed': speed, 'breathing': breathing, 'scenes': []}
    with tempfile.TemporaryDirectory(prefix='.narration-', dir=output.parent) as tmp:
        work = Path(tmp)
        delivery = work / 'narration'
        delivery.mkdir()
        for scene in result['scenes']:
            samples, sample_rate = engine.create(scene['narration'], voice=voice, speed=speed, lang=lang)
            samples = np.asarray(samples)
            if not len(samples) or not np.isfinite(samples).all() or np.max(np.abs(samples)) < 1e-5:
                raise ValueError(f"{scene['id']}: speech engine returned empty, invalid or silent audio")
            filename = scene['id'] + '.wav'
            target = delivery / filename
            sf.write(str(target), samples, sample_rate, subtype='PCM_16')
            seconds = sf.info(str(target)).duration
            scene['duration'] = retime(seconds, scene['narration'], plan['fps'], breathing)
            if scene['duration'] > 300:
                raise ValueError(f"{scene['id']}: narration exceeds 300 seconds; split the scene")
            scene['audio'] = str(output / filename)
            if scene.get('asset'):
                scene['asset'] = str((base / scene['asset']).resolve())
            if isinstance(scene.get('generation'), dict):
                for field in ('workflow', 'receipt'):
                    if scene['generation'].get(field):
                        scene['generation'][field] = str((base / scene['generation'][field]).resolve())
            receipt['scenes'].append({'id': scene['id'], 'speech_seconds': seconds, 'scene_seconds': scene['duration'], 'audio_sha256': sha256_file(target)})
            print(json.dumps(receipt['scenes'][-1]), flush=True)
        (delivery / 'plan.json').write_text(json.dumps(result, indent=2) + '\n')
        (delivery / 'narration-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
        os.rename(delivery, output)
    return output / 'plan.json'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('plan', type=Path)
    parser.add_argument('--output', type=Path, required=True, help='new directory for WAV files and retimed plan')
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--voices', type=Path, required=True)
    parser.add_argument('--voice', default='af_sarah')
    parser.add_argument('--lang', default='en-us')
    parser.add_argument('--speed', type=float, default=1.0)
    parser.add_argument('--breathing', type=float, default=.3)
    args = parser.parse_args()
    try:
        print(narrate(args.plan, args.output, args.model, args.voices, args.voice, args.lang, args.speed, args.breathing))
    except (ValueError, OSError, KeyError, TypeError, RuntimeError) as error:
        parser.exit(1, f'narrate: {error}\n')


if __name__ == '__main__':
    main()
