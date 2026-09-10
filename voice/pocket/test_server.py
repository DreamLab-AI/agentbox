"""Contract tests without loading real model weights."""
import io
import wave
from unittest.mock import patch

import msgpack
import numpy as np
import torch
from fastapi.testclient import TestClient
import server


class FakeModel:
    def get_state_for_audio_prompt(self, voice):
        return voice

    def generate_audio_stream(self, state, text):
        for _ in range(2):
            yield torch.ones(1920) * .1


def test_http_contract():
    server.voice_state.cache_clear()
    with patch.object(server.TTSModel, 'load_model', return_value=FakeModel()), TestClient(server.app) as client:
        assert client.get('/health').json()['device'] == 'cpu'
        assert client.get('/api/build_info').status_code == 200
        response = client.post('/v1/audio/speech', json={'input': 'Hello.'})
        with wave.open(io.BytesIO(response.content)) as wav:
            assert wav.getframerate() == 24000
            assert wav.getnframes() == 3840
        assert client.post('/v1/audio/speech', json={'input': 'Hello.', 'voice': '../../bad'}).status_code == 400
        assert client.post('/v1/audio/speech', json={'input': 'Hello.', 'response_format': 'mp3'}).status_code == 400
        response = client.post('/v1/audio/speech', json={'input': 'Hello.', 'stream': True, 'response_format': 'pcm'})
        assert len(response.content) == 7680
        assert np.frombuffer(response.content, dtype='<i2').max() > 100


def test_incremental_web_contract():
    server.voice_state.cache_clear()
    with patch.object(server.TTSModel, 'load_model', return_value=FakeModel()), TestClient(server.app) as client:
        with client.websocket_connect('/api/tts_streaming?voice=alba') as ws:
            assert msgpack.unpackb(ws.receive_bytes())['type'] == 'Ready'
            ws.send_bytes(msgpack.packb({'type': 'Text', 'text': 'Hello.'}))
            ws.send_bytes(msgpack.packb({'type': 'Eos'}))
            assert msgpack.unpackb(ws.receive_bytes())['type'] == 'Text'
            audio = msgpack.unpackb(ws.receive_bytes())
            assert audio['type'] == 'Audio' and len(audio['pcm']) == 1920
