# Web DAW Long-Session Threshold Plan

**Scope:** Browser-based Uuda Studio only. This plan does not introduce a duration cap and does not cover desktop packaging.

**Status:** Proposed acceptance plan. All performance targets below are provisional until measured on a named reference machine. A target is not passed based on code inspection alone.

## Principles

1. Treat 15, 30, 60, 90 and 120 minutes as required test tiers, not product limits.
2. Preserve audio correctness, waveform caching, project recovery and local-only export while optimizing.
3. Never fake progress. Report completed work where measurable; during opaque browser operations such as `OfflineAudioContext.startRendering()`, show an honest indeterminate/elapsed-time state rather than invented percentage movement.
4. Prefer bounded/chunked processing and fewer full-buffer copies. Keep algorithms with lookahead or state continuous across chunk boundaries; validate joins against the serial reference.
5. Test the same reference project and environment across changes. Record browser/version, OS, RAM, sample rate, channels, track/clip counts, effects, cache state and export settings.
6. Do not call a duration tier accepted until automated checks and the relevant browser run both pass.

## Duration tiers and required scenarios

| Tier | Core purpose | Required scenarios | Gate |
|---|---|---|---|
| 15 min | Fast regression baseline | Import, waveform render/cache, seek and scrub, repeated zoom, save/reopen, WAV and MP3 export, mastering | All functional/integrity checks pass; establish baseline timings and memory |
| 30 min | Medium-session regression | Repeat 15-min scenarios; perform multiple zoom levels and repeated exports in one session | No meaningful degradation versus the 15-min trend beyond the measured cost of more samples; no stale cache or progress state |
| 60 min | Long-session stress | Repeat mastering and export; seek near start/middle/end; persist and reopen; monitor memory throughout | No crash/tab reload, audio corruption, silent persistence failure or unbounded memory growth |
| 90 min | Extended-session stress | Repeat long-session scenarios after at least one completed export; test zoom during playback and while stopped | UI remains responsive; memory returns toward a stable post-operation baseline; repeated operation does not compound allocations |
| 120 min | Upper endurance tier | Full import-to-reopen lifecycle, mastering, WAV/MP3 export, repeated zoom/scrub and recovery checks | Same correctness gates as shorter tiers; any unsupported resource limit must fail clearly and safely, never report a false success |

Use stereo 48 kHz Float32 material as the primary memory stress profile, then test representative mono and other supported formats. Include a simple single-track case and a realistic multi-track/effects case. Record source duration and decoded sample count; compressed file size alone is not a useful memory estimate.

## Provisional responsiveness targets

These are engineering targets to baseline and ratify, not claims of current performance.

| Metric | Target for each tier | Measurement |
|---|---|---|
| Zoom gesture | 95th percentile input-to-visible-update <= 100 ms; no repeated broken anchor/alignment | Browser performance trace; repeat at beginning, middle and end of project |
| Ordinary timeline interaction | 95th percentile <= 100 ms; no interaction task > 200 ms where avoidable | Long-task/Performance trace during zoom, scroll, seek and scrub |
| Progress during app-controlled DSP/encoding | A meaningful completed-work update at least every 2 seconds while work is actively advancing | Timestamp progress callbacks and UI paints; confirm percentages are monotonic |
| Opaque offline render | Honest stage label plus elapsed-time heartbeat at least every 2 seconds; do not imply exact render percentage | UI recording and callback timestamps |
| Memory | No unexplained monotonic growth across repeated identical operations; peak and post-operation memory recorded at every tier | Browser/task-manager memory where available, JS heap where available, allocation/GC trace |
| Audio integrity | Duration, channel count, sample order and boundary behavior match approved reference tolerances; no truncation, channel swap or new clicks | Automated comparison plus listening check for representative outputs |
| Persistence/recovery | Save/reopen retains project and audio; quota, missing asset and corrupt-file cases warn clearly | Clean-session round trip and failure-injection results |
| Export performance | Record wall time for each stage and format; after baseline, prevent >20% regression on the same machine unless explained and approved | Repeated runs, separate cold/warm cache, same settings |

The 2-second progress cadence applies only when the application controls the work loop. During a single opaque browser API call, elapsed time can be shown, but a moving percentage must not be invented.

## Memory sizing reference

For decoded 48 kHz stereo Float32 audio, one full source-sized buffer is approximately:

| Duration | One stereo Float32 buffer (decimal) | Approx. MiB |
|---|---:|---:|
| 15 min | 345.6 MB | 329.6 MiB |
| 30 min | 691.2 MB | 659.2 MiB |
| 60 min | 1.382 GB | 1,318 MiB |
| 90 min | 2.074 GB | 1,978 MiB |
| 120 min | 2.765 GB | 2,637 MiB |

This is the size of one interleaved-equivalent pair of channel arrays, not a complete project memory estimate. Browser AudioBuffers store channels separately, but the combined Float32 sample bytes are equivalent. Render buffers, source buffers, channel copies, analysis arrays, encoded output and waveform caches can multiply peak usage. Measure actual memory rather than treating this table as a cap or a guarantee that a browser can allocate it.

## Implementation sequence

### Phase A — close current correctness and observability gaps
- Re-run lint/type-check, unit tests and production build in an environment with dependencies installed.
- Confirm mastering progress stays monotonic, reaches each stage, and does not stall silently at the limiter stage.
- Keep the offline render heartbeat explicitly indeterminate/elapsed; capture errors and cleanup paths.
- Verify timeline zoom anchoring and waveform-cache behavior with pure tests and browser profiling.
- Keep PR #34 open until checks and acceptance evidence are available.

### Phase B — establish the 15- and 30-minute baselines
- Capture import-to-track, waveform-ready, save/reopen, mastering-stage and WAV/MP3 export timings.
- Record peak and post-operation memory, UI long tasks and progress callback/paint timestamps.
- Run each scenario at least twice, separating cold and warm cache results.
- Add reproducible fixtures and regression tests for algorithm output, progress ordering, chunk boundaries and cleanup on failure.

### Phase C — make long processing bounded
- Inventory every duration-proportional allocation in mastering, rendering, encoding, persistence and waveform analysis.
- For each full-buffer allocation, document why it is required or replace it with a bounded/chunked path where the algorithm permits.
- Preserve limiter lookahead and filter state across chunk boundaries; add exact/reference comparisons at chunk edges and for empty/short inputs.
- Evaluate workers for CPU-heavy DSP only after serial output correctness is established. Workers are not a substitute for reducing peak memory.
- Keep waveform cache bounded and aggregate from cached coarser/finer levels without rescanning the whole source for every zoom.
- Avoid creating a full-size encoded output or duplicate intermediate unnecessarily; where a format/API requires a complete output object, document that remaining peak-memory floor.

### Phase D — graduate 60, 90 and 120 minutes
- Run the full tier matrix in order; record all failures and traces.
- Repeat the same operation several times in one session to expose retained buffers/cache growth.
- Test save/reopen and export after mastering, not only on a fresh import.
- Do not mark a tier passed if it only succeeds with DevTools closed unless that condition is explicitly recorded and justified.
- If a tier fails due to device/browser resource limits, fail gracefully and preserve the project; use evidence to guide architecture rather than adding an arbitrary duration cap.

## Release gate

A release candidate is ready for user browser acceptance only after:
- automated lint/type-check, unit tests and production build pass in the supported project environment;
- no known audio-integrity or persistence regression remains;
- the 15- and 30-minute tiers pass;
- 60/90/120-minute results are recorded as pass, fail or blocked with evidence, never inferred;
- remaining browser-only checks are clearly listed for the user.

## Evidence record template

For every run, attach: commit SHA; browser/version; OS; RAM/device; power mode; source format/duration/sample rate/channels; track/clip/effect counts; cold/warm cache; test scenario; stage timings; peak/post-operation memory; long tasks; progress timestamps; output-integrity metrics; save/reopen result; pass/fail and trace/log location.
