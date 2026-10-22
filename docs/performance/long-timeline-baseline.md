# Long-timeline performance baseline

Status: source inspection baseline; runtime measurements not yet collected.
Date: 2026-10-22
Branch context: `fix/timeline-playhead-alignment`

## Scope and protocol status

The ruler-alignment browser checks are explicitly deferred per user direction. This is a recorded open item, not a passed gate. This baseline work is independent source inspection and does not claim runtime acceptance.

## Current implementation observations

- `src/components/Timeline.tsx` derives project duration from the latest clip end, with a 60-second minimum and 15 seconds of padding. The minimum is not a duration cap.
- `lanePixelWidth = max(1200, ceil(totalDurationSeconds * pixelsPerSecond))` makes lane width proportional to project duration and zoom.
- The track-row canvas intrinsic width follows `timelineWidth`, which is itself raised to at least `lanePixelWidth`. A long project can therefore allocate very wide canvases per track.
- `renderTrackWaveforms` paints the background across the full canvas width, then iterates clips. Waveform peak generation is invoked during rendering when an asset buffer exists.
- `src/waveform/cache.ts` stores mono merged audio in a `Float32Array` per asset and peak arrays per asset/resolution. There is no capacity limit or LRU eviction in the inspected implementation; entries are removed only by explicit `clearAsset`.
- `src/audio/engine.ts` decodes imported audio into Web Audio `AudioBuffer` data and clones input buffers in some decode paths. Decoding and the waveform mono copy can substantially increase peak memory.

## Analytical memory sizing (not a benchmark)

For uncompressed 48 kHz stereo float32 audio, sample storage alone is:

| Duration | Stereo decoded samples | Additional mono float32 copy |
|---|---:|---:|
| 10 minutes | ~230 MB | ~115 MB |
| 60 minutes | ~1.38 GB | ~691 MB |
| 120 minutes | ~2.76 GB | ~1.38 GB |

These decimal estimates use duration × 48,000 samples/s × channels × 4 bytes/sample. They exclude encoded input, browser/Web Audio overhead, peak arrays, canvas backing stores, other tracks, and temporary copies. They are not measured application memory or guaranteed allocation sizes.

## Benchmark plan / acceptance evidence still needed

Use a consistent browser/device/build and record the hardware, browser version, zoom, track count, clip count, audio format, and whether assets are already decoded. Exercise 10-, 60-, and 120-minute arrangements at multiple zoom levels.

Record:
- initial timeline render and first waveform-visible latency;
- scroll/zoom responsiveness and time to settle after each change;
- peak browser memory and canvas dimensions/count;
- main-thread long tasks while first drawing waveforms;
- playback start, seek and editing responsiveness;
- repeat-open behavior and memory after assets are released.

No performance thresholds are invented here; establish observed baseline values first, then set target budgets based on the supported product envelope.

## Proposed investigation order

1. Decouple logical duration from viewport/canvas backing width while preserving clip coordinates and interaction behavior.
2. Bound or redesign waveform peak/mono caches, with explicit asset invalidation and tests.
3. Consider viewport/visible-region rendering and progressive or multiresolution peak generation.
4. Validate playback, editing, waveform correctness, memory and cache invalidation before acceptance.

## Open items

- Category B: browser verification of timeline ruler/playhead/seek behavior is deferred by explicit user direction; not verified.
- Category B: long-timeline runtime measurements have not been collected; this file is source-derived baseline only.
