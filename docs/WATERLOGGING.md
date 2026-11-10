# Waterlogging risk (experimental)

`GET /api/map/waterlogging?south&west&north&east` and the map layer
**"Waterlogging risk (experimental)"**. It is an **estimate**, not a measurement:
it is never an alert level, never pushed, and always labelled "experimental ·
estimated · not official IMD".

On the map: choose **Waterlogging (experimental)**. Zoomed out further than a
city the map says so and offers **Zoom in here** (no request is sent). Tap a
hexagon for its parts: rain (9 h total and wettest hour), how many metres it
lies below or above its surroundings, and nearby waterlogging reports.

> **Default, not calibrated.** The formula, its weights (0.4, 0.6, 0.3), the
> scales (50 mm, 15.2 mm/h, 15 m, 1.5) and the level cut-offs are reasoned
> starting values. They have not been fitted to observed waterlogging. The map
> legend says so too ("The formula's weights are defaults, not calibrated").

## What it combines, per H3 hexagon

Resolution 8: hexagons about 1 km across, over a city-sized view (at most 0.3° a
side, about 33 km; zoomed out further the map says "zoom in").

| Part | 0 … 1 | From |
|------|-------|------|
| **Rain R** | `min(1, max(total / 50 mm, peak / 15.2 mm/h))` | Open-Meteo hourly rain at the nearest model point (grid ≈ 8 km), over the **past 3 h and the next 6 h**: the 9 h total against the extreme-rain value (50 mm, `EXTREME_RAIN`), or the wettest hour against twice the AMS heavy-rain rate (2 × 7.6 mm/h), whichever is larger. One batched request for the view, cached 15 min. |
| **Lowness L** | `clamp(low_m / 15 m, 0, 1)` | How many metres the hexagon lies **below the mean of the two rings of hexagons around it**. Ground height from the terrain tiles the map already uses (AWS Terrain Tiles, Mapzen terrarium, zoom 11 ≈ 76 m pixels): the mean of the hexagon's centre and its 6 corners. Higher than its surroundings: 0. |
| **Reports C** | `min(1, Σ weight / 1.5)` | Live **waterlogging** community reports within 1.5 km, weighted by trust: low 0.25, medium 0.5, high 1 (`docs/REPORTS.md`). |

```
score = min(1, R × (0.4 + 0.6 × L) + 0.3 × C)
```

**Levels** (`thresholds.py`, `WATERLOG_LEVELS`): score ≥ 0.15 low, ≥ 0.35
moderate, ≥ 0.6 high; below 0.15 nothing is drawn.

How to read it:

- **No rain, no reports: no risk.** However low a place is, R = 0 gives 0.
- Heavy rain on level or high ground: 0.4 → moderate. The same rain in a dip
  15 m below its surroundings: 1.0 → high.
- Reports alone (no model rain) add at most 0.3: low at most. They raise an
  estimate; they cannot create a high one without rain.

The response gives each hexagon's score, level and parts (`rain_mm`,
`peak_mm_h`, `low_m`, `reports`), the 9 h window, the terrain source and
whether reports were available.

## Limits (said on the map and here)

- **Rain is coarse.** The model grid is about 8 km, so every hexagon inside one
  model cell gets the same rain; a cloudburst over one neighbourhood is not
  resolved.
- **Terrain is coarse.** 76 m pixels miss underpasses, subways, basements and
  small dips; buildings and flyovers are not in the terrain model.
- **No drainage.** Drains, pumps, canals, soil and pavement are unknown; a
  well-drained low area is scored like a badly drained one.
- **Tides and rivers are not included** (coastal Mumbai floods worse at high tide).
- If the terrain tiles cannot be read, every hexagon is treated as level ground
  (rain and reports only); if Open-Meteo cannot be read, the endpoint answers 503.

It is labelled experimental until it has been checked against community reports
over a monsoon season (`docs/VISION.md`, step 4).
