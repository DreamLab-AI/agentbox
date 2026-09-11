FROM pytorch/pytorch:2.9.1-cuda12.8-cudnn9-runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends libsndfile1 \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir \
      'transformers>=5.13.0,<6' \
      'accelerate>=1.12,<2' \
      'fastapi>=0.116,<1' \
      'uvicorn[standard]>=0.35,<1' \
      'msgpack>=1.1,<2' \
      'librosa>=0.11,<1' \
      'scipy>=1.15,<2'

WORKDIR /app
COPY server.py /app/server.py
ENTRYPOINT ["python", "/app/server.py"]
