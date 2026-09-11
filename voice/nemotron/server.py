"""Nemotron 3.5 streaming ASR adapter for the Unmute MessagePack contract."""

import asyncio
import contextlib
import os
import queue
import threading
from collections.abc import Iterator

import msgpack
import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from scipy.signal import resample_poly
from transformers import AutoModelForRNNT, AutoProcessor, TextIteratorStreamer

MODEL_ID = os.getenv("ASR_MODEL", "nvidia/nemotron-3.5-asr-streaming-0.6b")
LANGUAGE = os.getenv("ASR_LANGUAGE", "auto")
LOOKAHEAD = int(os.getenv("ASR_LOOKAHEAD_TOKENS", "3"))
INPUT_RATE = 24_000
MODEL_RATE = 16_000
FRAME_SECONDS = 0.08
SILENCE_RMS = float(os.getenv("ASR_SILENCE_RMS", "0.012"))
ENDPOINT_SECONDS = float(os.getenv("ASR_ENDPOINT_SECONDS", "0.48"))

processor = None
model = None
model_gate = threading.Lock()


def _pack(message: dict) -> bytes:
    return msgpack.packb(message, use_bin_type=True, use_single_float=True)


def _resample(samples: np.ndarray) -> np.ndarray:
    """Convert one exact 80 ms input frame from 24 kHz to 16 kHz."""
    if samples.size == 0:
        return np.zeros(0, dtype=np.float32)
    return resample_poly(samples.astype(np.float32, copy=False), 2, 3).astype(
        np.float32, copy=False
    )


class FeatureStream(Iterator):
    """Blocking audio queue consumed by Transformers' cache-aware generator."""

    def __init__(self, chunks: queue.Queue, emit):
        self.chunks = chunks
        self.emit = emit
        self.first = True

    def __iter__(self):
        return self

    def __next__(self):
        while True:
            audio = self.chunks.get()
            if audio is None:
                raise StopIteration
            if isinstance(audio, dict):
                self.emit(audio)
                continue
            break
        inputs = processor(
            audio,
            sampling_rate=MODEL_RATE,
            is_streaming=True,
            is_first_audio_chunk=self.first,
            language=LANGUAGE,
            return_tensors="pt",
        )
        self.first = False
        return inputs.to(model.device, dtype=model.dtype)


def _run_recognizer(chunks: queue.Queue, emit, stop: threading.Event) -> None:
    """Own one model stream and forward decoded text fragments to the event loop."""
    if not model_gate.acquire(blocking=False):
        emit({"type": "Error", "message": "ASR is serving another stream"})
        return
    try:
        stream = FeatureStream(chunks, emit)
        try:
            first_inputs = next(stream)
        except StopIteration:
            return
        streamer = TextIteratorStreamer(
            processor.tokenizer, skip_prompt=True, skip_special_tokens=True
        )
        # Transformers detects a generator specifically for cache-aware input;
        # a generic Iterator is treated as a tensor by its model-input path.
        def input_features_generator():
            yield first_inputs.input_features[
                :, : processor.num_mel_frames_first_audio_chunk, :
            ]
            for inputs in stream:
                yield inputs.input_features

        kwargs = dict(first_inputs)
        kwargs["input_features"] = input_features_generator()
        kwargs["streamer"] = streamer
        kwargs["num_lookahead_tokens"] = LOOKAHEAD
        def generate():
            try:
                model.generate(**kwargs)
            except Exception as exc:
                emit({"type": "Error", "message": f"ASR inference failed: {exc}"})
                streamer.end()

        inference = threading.Thread(
            target=generate, daemon=True, name="nemotron-generate"
        )
        inference.start()
        for text in streamer:
            if stop.is_set():
                break
            if text:
                emit({"type": "Word", "text": text, "start_time": 0.0})
        inference.join(timeout=10)
    except Exception as exc:
        emit({"type": "Error", "message": f"ASR inference failed: {exc}"})
    finally:
        model_gate.release()


@contextlib.asynccontextmanager
async def lifespan(_app):
    global processor, model
    processor = await asyncio.to_thread(AutoProcessor.from_pretrained, MODEL_ID)
    processor.set_num_lookahead_tokens(LOOKAHEAD)
    model = await asyncio.to_thread(
        AutoModelForRNNT.from_pretrained,
        MODEL_ID,
        dtype=torch.bfloat16,
        device_map="cuda:0",
    )
    model.eval()
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
@app.get("/api/build_info")
def health():
    return {
        "status": "ok",
        "engine": "nemotron-3.5-asr-streaming",
        "model": MODEL_ID,
        "language": LANGUAGE,
        "latency_ms": LOOKAHEAD * 80 + 80,
    }


@app.websocket("/api/asr-streaming")
async def streaming(ws: WebSocket):
    await ws.accept()
    loop = asyncio.get_running_loop()
    chunks: queue.Queue = queue.Queue(maxsize=64)
    stop = threading.Event()
    output: asyncio.Queue = asyncio.Queue(maxsize=128)
    pending = np.zeros(0, dtype=np.float32)
    frame_samples = int(INPUT_RATE * FRAME_SECONDS)
    # Transformers 5.17 advertises 4040 here, which librosa turns into 26 mel
    # frames although the model contract requires 25. Derive the exact window
    # from the declared mel-frame count and hop length (25 * 160 = 4000).
    first_samples = int(
        processor.num_mel_frames_first_audio_chunk
        * processor.feature_extractor.hop_length
    )
    chunk_samples = int(processor.num_samples_per_audio_chunk)
    needed = first_samples
    silent_frames = 0
    elapsed = 0.0
    worker_started = False
    model_samples_received = 0
    pending_markers = []

    def emit(message):
        if not stop.is_set():
            asyncio.run_coroutine_threadsafe(output.put(message), loop)

    worker = threading.Thread(
        target=_run_recognizer,
        args=(chunks, emit, stop),
        daemon=True,
        name="nemotron-session",
    )

    async def send_output():
        while True:
            message = await output.get()
            if message is None:
                return
            if message.get("type") == "Word":
                message["start_time"] = max(0.0, elapsed - 0.32)
            await ws.send_bytes(_pack(message))

    sender = asyncio.create_task(send_output())
    await ws.send_bytes(_pack({"type": "Ready"}))
    try:
        while True:
            raw = await ws.receive_bytes()
            message = msgpack.unpackb(raw, raw=False)
            kind = message.get("type")
            if kind == "Marker":
                # Kyutai's original server delays markers by the ASR lookahead;
                # Unmute sends 0.5 s of silence after each marker specifically
                # to flush final tokens. Preserve that ordering contract.
                pending_markers.append(
                    (message["id"], model_samples_received + MODEL_RATE // 2)
                )
                continue
            if kind != "Audio":
                await output.put({"type": "Error", "message": "Expected Audio or Marker"})
                continue
            audio = np.asarray(message.get("pcm", []), dtype=np.float32)
            if audio.size == 0:
                continue
            elapsed += audio.size / INPUT_RATE
            # The client normally sends exact 80 ms frames. Endpointing is
            # deliberately conservative to avoid clipping mid-sentence pauses.
            rms = float(np.sqrt(np.mean(np.square(audio))))
            silent_frames = silent_frames + 1 if rms < SILENCE_RMS else 0
            silence_probability = (
                0.95 if silent_frames * FRAME_SECONDS >= ENDPOINT_SECONDS else 0.02
            )
            steps = max(1, round(audio.size / frame_samples))
            for _ in range(steps):
                await output.put(
                    {"type": "Step", "step_idx": round(elapsed / FRAME_SECONDS), "prs": [0.0, 0.0, silence_probability]}
                )
            model_audio = _resample(audio)
            model_samples_received += model_audio.size
            pending = np.concatenate((pending, model_audio))
            while pending.size >= needed:
                chunks.put_nowait(pending[:needed])
                pending = pending[needed:]
                if not worker_started:
                    worker.start()
                    worker_started = True
                needed = chunk_samples
            while pending_markers and model_samples_received >= pending_markers[0][1]:
                marker_id, _ = pending_markers.pop(0)
                if pending.size:
                    chunks.put_nowait(np.pad(pending, (0, needed - pending.size)))
                    pending = np.zeros(0, dtype=np.float32)
                    needed = chunk_samples
                    if not worker_started:
                        worker.start()
                        worker_started = True
                chunks.put_nowait({"type": "Marker", "id": marker_id})
    except WebSocketDisconnect:
        pass
    finally:
        if pending.size:
            with contextlib.suppress(queue.Full):
                chunks.put_nowait(pending)
        with contextlib.suppress(queue.Full):
            chunks.put_nowait(None)
        if worker_started:
            await asyncio.to_thread(worker.join, 12)
        stop.set()
        await output.put(None)
        with contextlib.suppress(Exception):
            await sender


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
