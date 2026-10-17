"""Marker ordering tests without loading real model weights.

Regression: the last word of every utterance was never delivered.
TextStreamer releases text only up to the last space, holding the final word
until generation ends (client disconnect), while the Marker echo was emitted
at once. These tests drive the real Transformers streamer with a fake
tokenizer/model and assert the held word precedes the Marker echo.
"""
import queue
import threading

import numpy as np

import server

VOCAB = {0: "Show", 1: " call", 2: "ers", 3: " of", 4: " main", 5: "."}
# Tokens the fake model decodes for each audio chunk it consumes.
TOKENS_PER_CHUNK = [[0], [1, 2], [3, 4, 5]]


class FakeTokenizer:
    def decode(self, ids, **_kwargs):
        return "".join(VOCAB[i] for i in ids)


class FakeInputs(dict):
    def __init__(self):
        features = np.zeros((1, 30, 4), dtype=np.float32)
        super().__init__(input_features=features)
        self.input_features = features

    def to(self, *_args, **_kwargs):
        return self


class FakeProcessor:
    tokenizer = FakeTokenizer()
    num_mel_frames_first_audio_chunk = 25

    def __call__(self, *_args, **_kwargs):
        return FakeInputs()


class FakeModel:
    device = "cpu"
    dtype = np.float32

    def generate(self, input_features, streamer, **_kwargs):
        # Like Transformers' generate(), the prompt (decoder start ids) is put
        # first; server.py's skip_prompt=True discards exactly this put.
        streamer.put(np.array([[-1]]))
        # Cache-aware streaming: decode each chunk as it is pulled from the
        # generator; the pull for the NEXT chunk is what reaches a Marker.
        for i, _features in enumerate(input_features):
            if i < len(TOKENS_PER_CHUNK):
                streamer.put(np.array(TOKENS_PER_CHUNK[i]))
        streamer.end()


def _drain(streamer):
    items = []
    while not streamer.text_queue.empty():
        items.append(streamer.text_queue.get_nowait())
    return items


def test_flush_releases_the_held_word_and_marker_follows_it():
    streamer = server.MarkerAwareStreamer(FakeTokenizer(), skip_prompt=False)
    for ids in TOKENS_PER_CHUNK:
        streamer.put(np.array(ids))
    released = "".join(i for i in _drain(streamer) if isinstance(i, str))
    assert released == "Show callers of "  # "main." is held by TextStreamer

    emitted = []
    chunks = queue.Queue()
    stream = server.FeatureStream(chunks, emitted.append)
    stream.streamer = streamer
    chunks.put({"type": "Marker", "id": 7})
    chunks.put(None)
    try:
        next(stream)
    except StopIteration:
        pass
    items = _drain(streamer)
    assert items == ["main.", {"type": "Marker", "id": 7}]
    assert emitted == []  # the Marker went through the Word queue, not around it
    streamer.flush()  # nothing held: a no-op
    assert _drain(streamer) == []


def test_marker_echo_follows_the_last_word_while_the_client_is_connected():
    server.processor = FakeProcessor()
    server.model = FakeModel()
    chunks = queue.Queue()
    out = queue.Queue()
    stop = threading.Event()
    worker = threading.Thread(target=server._run_recognizer, args=(chunks, out.put, stop), daemon=True)
    worker.start()
    for _ in TOKENS_PER_CHUNK:
        chunks.put(np.zeros(4000, dtype=np.float32))
    chunks.put({"type": "Marker", "id": 7})

    # The stream is still open (no None queued): this is the live session.
    words = []
    while True:
        message = out.get(timeout=5)
        if message["type"] == "Marker":
            break
        assert message["type"] == "Word", message
        words.append(message["text"])
    assert "".join(words) == "Show callers of main."
    assert message == {"type": "Marker", "id": 7}

    chunks.put(None)  # client disconnects
    worker.join(timeout=5)
    assert not worker.is_alive()
    assert server.model_gate.acquire(blocking=False)  # single-stream gate released
    server.model_gate.release()
