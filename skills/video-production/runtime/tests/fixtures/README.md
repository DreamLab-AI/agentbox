# Synthetic adapter fixtures

`dual-stage-guide-links.json` contains only the node classes and connections
needed to exercise the dual-stage guide adapter (IC-LoRA layout/reference guide
nodes, their consumers and the crop-guides metadata). It is not a complete or
runnable ComfyUI inference workflow, and requires no model files or service.

The node identifiers are an arbitrary example binding: tests name them through
a `workflow-bindings/1` map built in `film-bake.rs`, exactly as a production
supplies its own map. The fixture contains no production assets, paths, prompts
or cast. Clock, resolution and frame count are not part of it; each test
declares its own.
