# Contributing to EchoLoop

Thanks for wanting to contribute! Here's how to get set up.

## Development setup

```bash
git clone https://github.com/petejwoodbridge/EchoLoop.git
cd EchoLoop

python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows

pip install -r requirements.txt
pip install pytest
```

## Running tests

```bash
python -m pytest tests/ -v
```

All tests must pass before submitting a PR.

## Code style

- Python 3.11+ with type hints
- No external formatter enforced — just keep it consistent with the existing code
- Keep modules focused: audio capture, transcription, LLM engine, and UI are intentionally separated
- Prefer `asyncio` for I/O-bound work and thread pools for CPU-bound work

## Adding a new transcription backend

1. Create a new class implementing the `_Backend` ABC in `transcriber.py`
2. Add a new branch in `Transcriber._make_backend()`
3. Add any new config options to `TranscriberConfig` in `config.py`
4. Update `.env.example` and the README config table

## Adding a new LLM provider

1. Add a new branch in `_LLMClient._build_client()` and `get_advice()` in `engine.py`
2. Add config fields to `LLMConfig` in `config.py`
3. Update `.env.example` and the README

## Pull requests

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Write tests for new functionality
4. Make sure all tests pass
5. Submit a PR with a clear description of what and why

## Reporting bugs

Open an issue with:
- What you expected
- What happened
- Your OS, Python version, and relevant env vars (redact API keys)
