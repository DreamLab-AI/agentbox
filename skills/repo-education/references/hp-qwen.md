# HP Qwen: direct language and vision

This workflow uses the local Qwen model to reason about inspected source and real
screenshots together, and to draft the delivered-state explanation. The host agent
runs repository/browser/media tools and checks the output. Do not route through
Loom, add its scaffold or silently fall back to a hosted model.

## Discover before calling

The estate's direct endpoint is `http://192.168.2.132:8085`; its OpenAI-compatible
API is under `/v1`. This is distinct from the Loom facade on port 8084. Read
`/health`, `/v1/models` and `/props`, and use the returned model ID. Do not assume
that an installed model has a loaded vision projector.

On 2026-09-09 the shared endpoint served `qwen3.8-27b-heretic-q8_0` using
`/models/qwen3.8-27B-heretic/RVN-Q8_0.gguf`. Its `/props` reported vision false.
A successful text request to that service is insufficient for this skill.
The matching projector was available on HP at
`/home/john/models/qwen3.8-27B/mmproj-BF16.gguf`.

Prefer an already configured direct multimodal service. If it lacks vision, report
that condition and use an authorised isolated process with the matching projector,
or ask for the required service configuration. Do not restart the shared model or
alter its boot script as part of a documentation task. Do not publish a third LAN
model endpoint. An owned process with no network interface can be reached through
`docker exec` over SSH instead.

## Isolated CPU qualification

HP is reachable as `john@10.10.10.1`. The pilot used the existing `loom-model:local`
image but overrode its entrypoint, so neither its Loom facade nor its resident
model process handled the request. Models were mounted read-only. Adapt paths
only after inspecting the current host, image and model files.

```sh
docker run -d --name OWNED_UNIQUE_NAME --label task=repo-education-model-probe \
  --network none --memory 64g --cpus 16 --gpus all -e CUDA_VISIBLE_DEVICES=-1 \
  --read-only --tmpfs /tmp:rw,size=1g \
  --mount type=bind,src=/home/john/models,dst=/models,readonly \
  --entrypoint /usr/local/bin/llama-server loom-model:local \
  -m /models/qwen3.8-27B-heretic/RVN-Q8_0.gguf \
  --mmproj /models/qwen3.8-27B/mmproj-BF16.gguf --no-mmproj-offload \
  --device none -ngl 0 -c 8192 -t 16 -tb 16 --parallel 1 \
  --host 127.0.0.1 --port 8080 --jinja \
  --chat-template-file /models/qwen3.8-27B-heretic/chat-template.jinja \
  --reasoning off --reasoning-format deepseek --reasoning-budget 0 --temp 0 \
  --alias repo-education-qwen-vision
```

The GPU runtime flag supplies the image's required driver libraries;
`CUDA_VISIBLE_DEVICES=-1`, `--device none`, `-ngl 0` and
`--no-mmproj-offload` keep inference on CPU. The same image failed to start without
`libcuda.so.1` when launched without the GPU runtime. Check the owned container's
logs and `/props`; require `modalities.vision=true` before the combined request.
The pilot loaded both files in about ten seconds. The first trial using the GGUF
default template emitted reasoning until its 650-token budget was exhausted,
despite a zero reasoning budget and `enable_thinking=false`. Use the matching
vision-aware template explicitly and verify a complete final answer; advertised
capabilities and requested settings are not proof they took effect. CPU throughput must be measured;
do not extrapolate it to the resident GPU service.

Keep one owned process warm for a bounded batch rather than reloading weights for
every section. Reuse the shared read-only model cache. Do not occupy the shared
GPUs by stopping another workload or silently changing the resource plan.

## Evidence packet and request

Give the model a narrow reader question, exact file/line excerpts, declared runtime
mode and one relevant real screenshot. Supply enough surrounding code to support
the requested explanation. Avoid entire repositories, repeated full chapters,
base64 images embedded in prose and unrelated production logs. Preserve the
instruction prefix for cache reuse; put changing evidence at the end. Start with
an 8K context and a bounded answer, increasing either only when the task requires it.

Use `/v1/chat/completions` with typed content in one user message:

```json
{
  "model": "THE_DISCOVERED_MODEL_ID",
  "messages": [{"role": "user", "content": [
    {"type": "text", "text": "Reader question, final-state instructions and cited source excerpts"},
    {"type": "image_url", "image_url": {"url": "data:image/png;base64,IMAGE_BYTES"}}
  ]}],
  "temperature": 0,
  "max_tokens": 650,
  "stream": false,
  "chat_template_kwargs": {"enable_thinking": false}
}
```

For the network-isolated process, stream a local request file over SSH into
`docker exec -i OWNED_UNIQUE_NAME curl --data-binary @-` with JSON content type and
`http://127.0.0.1:8080/v1/chat/completions`. Keep inputs in a temporary directory;
do not pass source, credentials or images through command-line arguments.
A transport timeout is not proof that inference stopped: inspect the same process
and request before submitting another job. Record finish reason and reject a
truncated answer rather than treating incomplete JSON as a complete section.

## Quality gate and cleanup

Before batching, compare an isolated output against a section already independently
written and checked. Ask for an image-only fact absent from the text input as well
as a source-grounded explanation. Check exact visible text, UI labels, citation
accuracy, unsupported persistence/deployment claims, final-state prose and reader
clarity. Include a text-only control when needed to detect visual guessing.
An HTTP 200 or advertised vision capability alone does not pass this gate.

Keep a compact internal qualification receipt: discovered model/runtime identity,
input hashes, prompt/output token counts, latency, response hash, assessed criteria
and corrections required. Do not present one accepted section as proof of every
future section. Independently inspect each generated claim and final render.

After qualification, delete the owned scratch inputs and generated trial output,
and remove only the labelled task container. Preserve shared weights, the resident
model and the facade. Retain the compact receipt and reusable workflow in the skill;
resume the original project with its existing model policy and authority.

## Qualification result

The [recorded pilot](hp-qwen-qualification.json) used an existing campaign-editor
section, its screenshot and numbered source excerpts. The model quoted the exact
headline and selected panel from the image. With the explicit template it returned
a complete 348-token JSON draft in 208.9 seconds on CPU. Independent review caught
an unsupported implication that calling a save function proved successful saving.
A targeted revision corrected that claim and produced source-supported prose.
The warm process reused 2,961 prompt tokens: the 250-token revision took 68.4 seconds,
with only 116 prompt tokens processed. Keep a stable evidence prefix and output
schema across revisions; the model retained JSON despite a follow-up asking for
plain text. Qualified use is supervised drafting and visual inspection, with the
claim checks above, rather than unattended acceptance.

The owned test process and scratchpad were removed. The shared service remained
healthy and unchanged; enabling its GPU-backed vision mode was not part of this
isolated test. The CPU recipe is the tested combined-mode route.
