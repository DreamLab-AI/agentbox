FROM ghcr.io/astral-sh/uv:0.12.12-trixie
RUN apt-get update && apt-get install -y --no-install-recommends git patch && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/kyutai-labs/pocket-tts /app && git -C /app checkout --detach 0c2db3bdea7c991c568989cc11b503f14483fabc
WORKDIR /app
RUN uv venv /app/.venv --python 3.10 && uv pip install --python /app/.venv/bin/python 'torch @ https://download-r2.pytorch.org/whl/cpu/torch-2.13.0%2Bcpu-cp310-cp310-manylinux_2_28_x86_64.whl#sha256=f5cbb61180a9793d9e12fe115a2310d2600bd449dfb9a01ec5640e21359fa5ea'
RUN uv pip install --python /app/.venv/bin/python .
COPY cancellation.patch /tmp/cancellation.patch
RUN patch -p1 < /tmp/cancellation.patch && uv pip install --python /app/.venv/bin/python msgpack==1.2.1 websockets==15.0.1
COPY server.py /app/server.py
ENTRYPOINT ["/app/.venv/bin/python", "/app/server.py"]
