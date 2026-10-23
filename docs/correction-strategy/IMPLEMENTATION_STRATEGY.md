# Implementation Strategy

## Objective

Make long audio projects responsive, recoverable, and exportable without blocking the interface or creating unbounded memory pressure. This plan follows the supplied incident report and the current repository as inspection targets. It does not treat unmeasured hypotheses as proven facts.

## Engineering principles

1. **Bound work and memory.** Avoid operations whose cost scales with the entire recording during a gesture or UI event. Prefer viewport-bounded drawing, bounded caches, block processing, and explicit memory accounting.
2. **Separate availability from durability.** A track may become visible/playable before its asset is safely persisted, but the UI must show persistence state and must not imply that an unsaved asset is safe.
3. **Keep audio local.** Export must not upload the complete rendered WAV to a server for MP3 conversion; verify the actual call path and keep audio processing in-browser as required by the product specification.
4. **Preserve sound correctness.** Performance changes to limiter, mastering, segmentation, or rendering must be compared against a reference output and checked at boundaries.
5. **Do not fake progress.** Progress reflects completed work within named stages. A stage at 75% must remain responsive and provide meaningful stage-level progress.
6. **Profile before parallelizing.** Worker responsiveness and bounded memory are separate requirements. Parallel work is introduced only where measurements justify it and algorithm state can be preserved correctly.
7. **Small, testable changes.** Land changes in dependency order and rerun the same baseline after each change.

## Current execution state

The first coherent correction batch has been implemented in the working snapshot: import/persistence lifecycle, engine seek/restart coordination, viewport-sized waveform drawing and bounded peak caching, fit/follow navigation, linear-time yielding limiter, and browser-local block MP3 encoding. This is **IMPLEMENTED; NOT VERIFIED** until project type-check/tests/build and browser/audio acceptance checks pass. See [the correction register](./CORRECTION_REGISTER.md) for the exact outstanding queue.

The next execution must begin with outstanding B/C items rather than advancing to optional parallel rendering. In particular, the PRD's self-contained `.uuda` package requirement is an omitted authoritative requirement and is mandatory next-execution work, while the React render-rate issue and full export memory/progress profiling remain open.

## Correction sequence

### Phase 0 — Establish evidence and baseline

- Record the exact reproduction steps, browser/OS, file format, sample rate, channel count, duration, track count, and observed time/memory behavior.
- Trace import, waveform draw, seek/scrub, export, and MP3 conversion from UI event to underlying implementation.
- Confirm whether the report's suspected paths are still present in this repository version. Capture profiler traces and heap/task measurements before modifying DSP.
- Record the `.uuda` gap separately: the PRD describes a self-contained project package, but the provided repository snapshot does not obviously contain that implementation. Verify via repository search and tests before stating it is absent in the active branch.

### Phase 1 — Low-risk interaction and lifecycle fixes

- Ensure the “Decoding Audio…” toast is dismissed on success, failure, and cancellation.
- Make seek bounds derive from the current project/engine state, including immediately after importing long clips. Test both the app-level clamp and engine-level clamp.
- Serialize or otherwise safely coordinate scrub/restart operations so stop/start work cannot overlap or reset the playhead unexpectedly.
- Keep frame-rate playhead updates out of broad application state where possible; isolate updates to the playhead/counter view.

**Gate:** import, seek, scrub, and playback stay responsive; no stale-duration clamp or overlapping restart is observed in the targeted reproduction.

### Phase 2 — Waveform and timeline scalability

- Change drawing to work against the visible viewport and clip-visible region; do not allocate a single canvas proportional to the full recording duration.
- Build multi-resolution peak data incrementally or once per asset, then select the nearest suitable level while zooming. Zoom gestures must not trigger repeated full-file scans.
- Enforce cache budgets against actual typed-array allocations, including mono copies and all peak levels. Make cache eviction and allocation failure observable rather than silently leaving a blank canvas.
- Implement real fit-to-window, a zoom floor suitable for long projects, and playhead-follow behavior as separate UI features with tests.

**Gate:** repeated zoom/pan operations on long audio perform bounded work, waveform remains visible, and memory/cache usage remains within a measured budget.

### Phase 3 — Import visibility and durable persistence

- After decode and engine registration, add the track promptly rather than waiting for a large IndexedDB write to finish, if playback/render safety permits.
- Persist the asset asynchronously and expose an explicit per-track status such as saving/saved/failed. Retry or recovery behavior must be defined; do not show “saved” before persistence completes.
- Inspect `saveAssetToDB` for channel copies, structured-clone costs, and main-thread work. Remove unnecessary copies and avoid introducing additional full-length buffers.
- Keep decoded/playable state distinct from persisted/reopenable state.

**Gate:** users can understand whether imported audio is playable and whether it is durable; a failed/interrupted write does not masquerade as success.

### Phase 4 — Export and mastering bottlenecks

- Profile each named stage: render, loudness analysis, mastering/limiting, encoding, assembly, and verification. Tie displayed progress to these stages.
- Inspect the limiter implementation in `src/audio/mastering.ts`. If confirmed to rescan a window for every sample, replace it with a suitable sliding-window or otherwise bounded algorithm and compare output against a trusted reference.
- Move CPU-heavy analysis/encoding off the UI thread where supported. Process bounded blocks when the render graph permits it, avoiding multiple full-length render/mastering/analysis buffers.
- Trace the MP3 export caller and `/api/export/mp3` endpoint. Remove full-WAV upload and server-side conversion from the client export path in accordance with the “audio stays in browser” requirement.
- Stream or incrementally assemble output where feasible; avoid verification paths that decode the entire output into another large in-memory buffer.

**Gate:** UI remains responsive throughout export; progress advances by actual completed work; WAV/MP3 duration, channel order, sample order, peak/loudness behavior, and boundary continuity are verified.

### Phase 5 — Long-file-safe project/audio storage

- Preserve original source assets and treat waveform peaks as a derived cache, not the only source of truth.
- Investigate partial/region decoding and loading near the playhead only if the format and playback architecture support it; document formats that require full decode.
- Define atomic persistence, interruption recovery, storage quota handling, and a verified reopen path.
- Implement/restore a self-contained `.uuda` package containing project state and referenced audio assets. Do not call this complete until round-trip export/import and missing/corrupt-asset cases pass.

**Gate:** a saved project can be reopened independently of transient browser memory, with referenced audio intact and the last valid state recoverable.

### Phase 6 — Conditional parallel rendering

- Only begin after profiling and correctness baselines are in place.
- Classify each processing stage as stateless, stateful, or analysis-dependent. Stateful effects (for example delay/reverb/limiting) may require carried state, overlap, or a global analysis pass; do not cut arbitrary chunks and concatenate them.
- Benchmark a bounded worker pool (1, 2, and 4 workers) with memory and audio correctness measured together. Keep a serial fallback.

**Gate:** parallel output matches the accepted reference within defined tolerances, has no clicks/gaps/duplicate samples at joins, and improves end-to-end time without exceeding the memory budget.

## Dependency order

`Baseline → interaction fixes → viewport/peaks → import durability → export/mastering → project package/long-file architecture → optional parallel rendering`

Some investigation can run concurrently, but implementation should respect dependencies. Do not make parallel rendering a prerequisite for fixing the existing UI-thread bottlenecks.

## Change log convention

For each correction, record: issue ID, code paths changed, hypothesis confirmed/refuted, tests run, browser and test-file details, before/after measurements, known limitations, and rollback point. Update the correction register and validation matrix in the same change as the implementation.
