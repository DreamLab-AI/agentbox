"""Shared CPU Pocket speech service: HTTP narration and incremental voice WS.

No model per request. Single-model inference is serialised; background requests
yield between sentences to interactive requests. Disconnect joins model workers.
"""
import asyncio
import concurrent.futures
import contextlib
import io
import re
import struct
import threading
import wave
from functools import lru_cache

import msgpack
import numpy as np
from fastapi import FastAPI, Form, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, StreamingResponse
from pocket_tts import TTSModel
from pydantic import BaseModel, Field
import uvicorn

VOICES = 'alba anna azelma bill_boerst caro_davy charles cosette eponine eve fantine george jane jean javert marius mary michael paul peter_yearsley stuart_bell vera'.split()
model = None
background_model = None
gate = threading.Lock()
background_gate = threading.Lock()
priority_condition = threading.Condition()
interactive_waiters = 0


@lru_cache(maxsize=8)
def voice_state(voice, background=False):
    return (background_model if background else model).get_state_for_audio_prompt(voice)


@contextlib.asynccontextmanager
async def lifespan(app):
    global model, background_model
    model = TTSModel.load_model()
    background_model = TTSModel.load_model()
    for _ in model.generate_audio_stream(voice_state('alba'), 'Ready.'):
        pass
    for _ in background_model.generate_audio_stream(voice_state('alba', True), 'Ready.'):
        pass
    yield


app = FastAPI(lifespan=lifespan)


@app.get('/health')
@app.get('/api/build_info')
def health():
    return dict(status='ok', engine='pocket-tts', device='cpu', sample_rate=24000, workers={'interactive': 1, 'background': 1})


@app.get('/v1/voices')
def voices():
    return dict(voices=VOICES, default='alba', language='English')


def validate_voice(voice):
    if voice not in VOICES:
        raise HTTPException(400, 'Unknown Pocket voice; see /v1/voices')


async def pcm_audio(text, voice='alba', priority='interactive'):
    loop = asyncio.get_running_loop()
    output = asyncio.Queue(maxsize=2)
    stop = threading.Event()

    def put(value):
        future = asyncio.run_coroutine_threadsafe(output.put(value), loop)
        while not stop.is_set():
            try:
                future.result(timeout=.05)
                return True
            except concurrent.futures.TimeoutError:
                pass
        future.cancel()
        return False

    def produce():
        global interactive_waiters
        foreground = priority == 'interactive'
        selected_gate = gate if foreground else background_gate
        selected_model = model if foreground else background_model
        try:
            # Bound background monopolisation to one sentence / 180 characters.
            sentences = re.split(r'(?<=[.!?])\s+', text) if not foreground else [text]
            segments = []
            for sentence in sentences:
                if foreground:
                    segments.append(sentence)
                else:
                    words = sentence.split()
                    segment = ''
                    for word in words:
                        if len(segment) + len(word) > 180 and segment:
                            segments.append(segment)
                            segment = ''
                        segment += word + ' '
                    if segment:
                        segments.append(segment)
            for segment in segments:
                with priority_condition:
                    if foreground:
                        interactive_waiters += 1
                acquired = False
                try:
                    while not stop.is_set():
                        with priority_condition:
                            wait = False
                        if not wait and selected_gate.acquire(timeout=.02):
                            acquired = True
                            break
                        stop.wait(.01)
                finally:
                    if foreground:
                        with priority_condition:
                            interactive_waiters -= 1
                if not acquired:
                    return
                stream = None
                try:
                    if stop.is_set():
                        return
                    stream = selected_model.generate_audio_stream(voice_state(voice, not foreground), segment)
                    for chunk in stream:
                        if stop.is_set():
                            return
                        pcm = (chunk.detach().cpu().numpy().clip(-1, 1)*32767).astype('<i2').tobytes()
                        if not put(pcm):
                            return
                finally:
                    if stream is not None:
                        stream.close()
                    selected_gate.release()
            put(None)
        except Exception as exc:
            put(exc)

    thread = threading.Thread(target=produce, daemon=True)
    thread.start()
    try:
        while True:
            value = await output.get()
            if value is None:
                break
            if isinstance(value, Exception):
                raise value
            yield value
    finally:
        stop.set()
        await asyncio.to_thread(thread.join)


class SpeechRequest(BaseModel):
    input: str = Field(min_length=1, max_length=30000)
    voice: str = 'alba'
    model: str = 'pocket-tts'
    stream: bool = False
    response_format: str = 'wav'
    speed: float = Field(default=1, ge=.5, le=2)
    priority: str = 'interactive'


@app.post('/v1/audio/speech')
async def speech(request: SpeechRequest):
    validate_voice(request.voice)
    if request.response_format not in ('pcm', 'wav'):
        raise HTTPException(400, 'Supported formats: pcm (streaming), wav (complete file)')
    if request.speed != 1:
        raise HTTPException(400, 'Pocket synthesis uses speed=1; apply playback speed client-side')
    if request.priority not in ('interactive', 'background'):
        raise HTTPException(400, 'Invalid priority')
    if request.stream and request.response_format == 'pcm':
        return StreamingResponse(pcm_audio(request.input, request.voice, request.priority), media_type='audio/pcm', headers={'X-Sample-Rate': '24000', 'X-Audio-Format': 's16le'})
    pcm = b''.join([chunk async for chunk in pcm_audio(request.input, request.voice, request.priority)])
    if request.response_format == 'pcm':
        return Response(pcm, media_type='audio/pcm')
    data = io.BytesIO()
    with wave.open(data, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        wav.writeframes(pcm)
    return Response(data.getvalue(), media_type='audio/wav')


@app.post('/tts')
async def tts(text: str = Form(...), voice: str = Form('alba')):
    return await speech(SpeechRequest(input=text, voice=voice))


@app.websocket('/api/tts_streaming')
async def streaming(ws: WebSocket):
    """Incremental text / PCM MessagePack contract used by the web voice client.

    Text accumulates to a sentence, 160 characters or 250ms idle; Eos flushes.
    Text timestamps are sentence-level approximations, not forced alignment.
    """
    await ws.accept()
    voice = ws.query_params.get('voice') or 'alba'
    if voice not in VOICES:
        await ws.send_bytes(msgpack.packb(dict(type='Error', message='Unknown Pocket voice')))
        await ws.close()
        return
    queue = asyncio.Queue(maxsize=64)
    async def receive():
        buffer = ''
        while True:
            try:
                raw = await asyncio.wait_for(ws.receive_bytes(), timeout=.25)
            except asyncio.TimeoutError:
                if buffer.strip():
                    await queue.put(buffer)
                    buffer = ''
                continue
            message = msgpack.unpackb(raw)
            if message['type'] == 'Eos':
                if buffer.strip():
                    await queue.put(buffer)
                await queue.put(None)
                return
            if message['type'] != 'Text':
                raise ValueError('Only Text and Eos messages supported')
            buffer += message['text']
            if len(buffer) > 160 or re.search(r'[.!?]\s*$', buffer):
                await queue.put(buffer)
                buffer = ''

    async def generate():
        samples = 0
        while True:
            text = await queue.get()
            if text is None:
                return
            await ws.send_bytes(msgpack.packb(dict(type='Text', text=text, start_s=samples/24000, stop_s=samples/24000)))
            async with contextlib.aclosing(pcm_audio(text, voice)) as stream:
                async for pcm in stream:
                    values = (np.frombuffer(pcm, dtype='<i2').astype(np.float32)/32768).tolist()
                    samples += len(values)
                    await ws.send_bytes(msgpack.packb(dict(type='Audio', pcm=values), use_single_float=True))

    await ws.send_bytes(msgpack.packb(dict(type='Ready')))
    receiver = asyncio.create_task(receive())
    generator = asyncio.create_task(generate())
    try:
        done, _ = await asyncio.wait([receiver, generator], return_when=asyncio.FIRST_COMPLETED)
        if receiver in done:
            await receiver
            await generator
        else:
            await generator
    except (WebSocketDisconnect, RuntimeError):
        pass
    except Exception as exc:
        with contextlib.suppress(Exception):
            await ws.send_bytes(msgpack.packb(dict(type='Error', message=str(exc))))
    finally:
        receiver.cancel()
        generator.cancel()
        await asyncio.gather(receiver, generator, return_exceptions=True)
        with contextlib.suppress(RuntimeError):
            await ws.close()


if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=8000)
