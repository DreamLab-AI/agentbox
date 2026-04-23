# TerraCraft Example Locations

Five real-world locations with pre-computed bounding boxes, ready for world generation.

---

## 1. Times Square, New York City

Dense urban canyon with skyscrapers, Broadway, and commercial buildings.

```bash
terracraft generate 40.756,-73.988,40.760,-73.983 --scale 1 --enrich
```

Bounding box covers roughly 400m x 450m. Expect tall buildings (20-50 levels), wide roads, and pedestrian plazas. LLM enrichment adds accurate floor counts for the skyscrapers.

---

## 2. Westminster, London

Historic area including the Houses of Parliament, Westminster Abbey, and the Thames.

```bash
terracraft generate 51.498,-0.130,51.504,-0.120 --scale 1 --enrich
```

Covers the Palace of Westminster, Westminster Bridge, and surrounding streets. Water features from the Thames render as in-game water blocks. Gothic architecture enrichment benefits from the `--enrich` flag.

---

## 3. Shibuya Crossing, Tokyo

The world's busiest pedestrian crossing, surrounded by dense commercial buildings.

```bash
terracraft generate 35.658,139.699,35.662,139.703 --scale 1
```

Compact area (~400m square) with multi-storey commercial buildings, railway lines, and narrow streets. Railway elements from OSM become rail blocks in the generated world.

---

## 4. Colosseum, Rome

Ancient amphitheatre surrounded by Roman-era ruins and modern streets.

```bash
terracraft generate 41.888,12.488,41.893,12.494 --scale 2 --enrich
```

Uses `--scale 2` for higher detail on the curved Colosseum walls. The enrichment step adds appropriate stone and concrete materials. Nearby parks and archaeological sites provide varied terrain.

---

## 5. Sydney Opera House and Harbour

Iconic waterfront with the Opera House, Harbour Bridge approach, and Circular Quay.

```bash
terracraft generate -33.860,151.208,-33.854,151.216 --scale 1 --enrich --spawn -33.857,151.214
```

Note the negative latitude (Southern Hemisphere). The `--spawn` flag places the player near the Opera House forecourt. Water from Sydney Harbour fills in as ocean blocks. The Harbour Bridge approach road appears as elevated highway.
