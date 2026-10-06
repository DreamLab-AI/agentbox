# Ordered, non-overlapping dependency closures. The final buildImage layer
# contains only application/configuration paths not covered by these groups.
{ lib, n2c, groups }:
lib.foldl' (previous: group: previous ++ [ (n2c.buildLayer {
  deps = group.packages;
  layers = previous;
  maxLayers = 1;
  metadata.created_by = "agentbox:${group.name}";
}) ]) [] groups
