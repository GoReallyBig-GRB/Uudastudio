# Correction Register

Status labels: **Open** = not yet implemented/verified in this plan; **Investigate** = confirm in current code/runtime before changing; **Blocked** = dependent on another item; **Done** = merged and acceptance evidence recorded. Initial statuses are intentionally conservative.

| ID | Priority | Area | Reported failure / risk | Repository starting points | Planned correction | Acceptance evidence | Initial status |
|---|---|---|---|---|---|---|---|
| CS-00 | P0 | Baseline | Root causes and browser limits are not fully runtime-verified | Whole app; `package.json` scripts | Reproduce each symptom; collect profile, heap, task timing, environment and file metadata | Reproduction record and baseline measurements attached to change | Open |
| CS-01 | P1 | Import UI | “Decoding Audio…” toast may remain indefinitely | `src/App.tsx` import handler; toast API in `src/components/Toast.tsx` | Dismiss toast on success/failure and transition to a distinct persistence state | Cleanup is implemented; browser import success/failure/cancel checks remain | Implemented; NOT VERIFIED |
| CS-02 | P1 | Seek bounds | Engine seek range may be stale after importing longer audio | `src/App.tsx` `handleSeek`; `src/audio/engine.ts` seek/project-end state | Recompute engine end from the current project on seek | Code path is corrected; long-file seek runtime check remains | Implemented; NOT VERIFIED |
| CS-03 | P1 | Scrub/playback | Repeated stop/restart can race and reset playback position | `src/App.tsx`; `src/audio/engine.ts` play/stop/seek methods | Invalidate stale async play starts and serialize restart intent through a request generation | Race guard is implemented; repeated-scrub browser test remains | Implemented; NOT VERIFIED |
| CS-04 | P1 | React updates | Frame-rate playhead state may cause broad rerenders | `src/App.tsx`; timeline and counter components | Keep the authoritative clock in a ref; throttle React state commits while playing; isolate high-frequency drawing further only if profiling shows it is still needed | React profiler shows no whole-app rerender on every engine frame; playhead remains visually smooth and controls stay responsive | Partial; NOT VERIFIED |
| CS-05 | P1 | Waveform canvas | Canvas width may scale with entire project and exceed browser limits | `src/components/Timeline.tsx` canvas sizing/rendering | Use viewport-sized lane canvases and translate timeline-space drawing to the visible viewport | Canvas backing width is now viewport-sized in code; long-file browser check remains | Implemented; NOT VERIFIED |
| CS-06 | P1 | Waveform peaks | Zoom levels may trigger full-buffer peak scans and large mono allocation | `src/waveform/cache.ts`; `src/components/Timeline.tsx` `renderTrackWaveforms` | Remove full-length mono copy, quantize peak levels, aggregate coarser levels from cached finer levels, and enforce a 64 MiB LRU peak-cache budget | Unit test checks cached-finer aggregation; per-level scan cost, viewport rendering and memory still require browser profiling | Implemented in PR #20; CI PASS; runtime NOT VERIFIED |
| CS-07 | P1 | Timeline navigation | Fit-to-window/zoom floor/playhead-follow may not meet long-project needs | `src/App.tsx`; `src/components/Timeline.tsx`; `src/components/TimelineRuler.tsx` | Compute fit scale from viewport/project duration, lower zoom floor, and follow playhead near viewport edge | Code paths are implemented; resizing, 90-minute fit, and follow behavior need browser verification | Implemented; NOT VERIFIED |
| CS-08 | P1 | Import persistence | Track visibility may wait for full asset persistence; large writes/copies can stall | `src/App.tsx`; `src/storage/db.ts`; `src/audio/engine.ts` | Show track after decode, persist after yielding to UI, remove explicit channel copies, warn on failure, and exclude non-durable clips from autosave snapshots | Static safeguards are implemented; IndexedDB timing, quota failure, and reload recovery need runtime checks | Partial; NOT VERIFIED |
| CS-09 | P1 | Mastering limiter | Report suspects per-sample window rescans cause export to stall around 75% | `src/audio/mastering.ts`; `src/audio/masteringLimiter.test.ts` | Replace nested per-sample lookahead scans and full-length gain array with a monotonic sliding maximum; yield periodically | Reference-equivalence regression test passes in CI; real mastered-output comparison, long-export responsiveness and memory measurements remain open | Implemented in PR #20; CI PASS; audio/runtime NOT VERIFIED |
| CS-10 | P1 | Export memory | Multiple full-length buffers/analyses may exceed memory budget | `src/components/MasterExportPanel.tsx`; `src/audio/mastering.ts` | Stage memory accounting, bounded/block processing, avoid duplicate full-size intermediates | Peak memory recorded and under agreed cap for each reference duration | Investigate |
| CS-11 | P1 | MP3 locality | MP3 flow may upload complete WAV to server | `src/audio/mastering.ts`; `src/server/audioJobs.ts` | Remove the client upload path and encode locally in bounded PCM blocks | Current export function no longer calls `/api/export/mp3`; network capture and long-file runtime test remain | Implemented in PR #20; CI PASS; network/runtime NOT VERIFIED |
| CS-12 | P2 | Progress reporting | Progress may stall while synchronous work blocks paint | `src/components/MasterExportPanel.tsx` | Stage-weighted progress tied to completed operations; worker messaging where appropriate | UI paints during each stage; displayed stage/progress matches measured work | Investigate |
| CS-13 | P1 | Project format | PRD describes `.uuda` with audio, but the original snapshot only saved JSON | `src/storage/projectFile.ts`; `src/App.tsx`; `src/components/Header.tsx` | Implement versioned self-contained binary container, legacy JSON reader, Save/Save As/Open, shortcuts, unsupported-version refusal, missing-audio warning, and round-trip tests | Standalone stereo sample round-trip harness passed; Vitest, full app build, browser and large-file memory checks remain | Partial; NOT VERIFIED |
| CS-14 | P2 | Parallel render | Parallel segments can break stateful effects or increase memory pressure | Export/render graph; DSP/effects implementations | Profile first; classify stateful stages; benchmark 1/2/4 workers only after serial correctness | Reference-equivalent output, clean joins, measured speedup and bounded memory | Blocked by CS-09/10 |
| CS-15 | P1 | Performance targets | 90-minute target lacks measurable thresholds; stale baseline docs may conflict with current cache limits | `docs/` if present; PRD; `src/waveform/cache.ts` | Define 60-/90-minute responsiveness, memory, storage, and export targets; reconcile stale docs | Approved target table and reproducible reference-machine report | Open |

## First correction batch — implementation record (2026-10-22)

This is one coherent working-snapshot change set; no micro-branches were created. Statuses below mean code is changed, not that runtime acceptance has passed.

- **Import/playback:** import toast IDs are cleaned up; a decoded track is added before local persistence; pending/failed asset IDs are excluded from autosave snapshots until persistence succeeds; persistence errors explicitly warn that the in-memory track is not durable. IndexedDB serialization no longer creates an additional explicit full-length channel copy. Engine seek recomputes the current project end and invalidates stale asynchronous play starts.
- **Timeline/waveforms:** lane canvases are sized to the viewport instead of the full timeline width; drawing is translated into viewport coordinates; zoom levels are quantized; coarser peaks aggregate from cached finer levels; peak arrays use a 64 MiB LRU cache and no full-length mono copy; zoom-fit uses measured viewport width and project duration; playback follows the playhead near the right edge.
- **Export:** mastering lookahead peak detection is linear-time via a monotonic deque and no longer allocates a full-length gain-reduction array. The limiter yields periodically and reports progress during long passes. MP3 encoding no longer uploads a WAV to `/api/export/mp3` and converts PCM in encoder-sized blocks. A limiter reference-equivalence regression test was added.
- **Validation state:** TypeScript syntax/transpile checks passed for all 77 TS/TSX source/test files, and the production deque helper matched a straightforward reference implementation across 192 deterministic input/window cases, and coarser waveform peak aggregation matched direct stereo peak extraction in a standalone harness. Full type-check, Vitest, build, browser profiling, IndexedDB failure/reload tests, network capture, and real audio-output comparison remain **NOT VERIFIED** because project dependencies could not be installed in this environment (the install attempt timed out; `tsc` is blocked by the missing `vite/client` type package).

### Mandatory next-execution queue

- **CS-04 (B — current task incomplete):** a ref-backed authoritative playhead and 100 ms React-state throttle are now implemented, with an immediate update on pause/seek/stop. This reduces updates from roughly frame-rate to at most 10 per second during playback, but it does not yet prove that heavy children are isolated or that the visual movement is smooth. Verify with React Profiler; if the broad render remains material, move the high-frequency visual update into a narrow subscription/imperative drawing path rather than adding more throttles.
- **CS-06 (B — current task incomplete):** measure cache hit/miss scan costs and confirm viewport rendering on long recordings; consider incremental peak pyramid only if the measured cost requires it.
- **CS-09 (B — current task incomplete):** run the added test, compare mastered output against a reference, and measure UI responsiveness on long export.
- **CS-10 / CS-12 (B/C — current task incomplete):** profile analysis/render/encoding memory and ensure progress paints throughout every stage; main-thread loudness analysis remains a likely follow-up.
- **CS-13 (C — authoritative requirement only partially closed):** `.uuda` v1 writer/reader, legacy JSON support, Save/Save As/Open shortcuts, newer-version refusal, missing-audio warnings, and round-trip tests are now implemented. Standalone runtime round-trip and targeted strict type-check passed; Vitest/full build/browser validation remain NOT VERIFIED. Remaining required work: dirty-state and `beforeunload` lifecycle, per-tab autosave and orphan cleanup, version migration policy, file-picker behavior in Chromium, and large-file memory/runtime tests.
- **CS-00 / CS-15 (B/C — evidence gap):** runtime baseline and measurable 60-/90-minute resource targets remain open. Do not mark performance acceptance complete without named-machine measurements.

## Current code observations from static inspection

These observations are code-level evidence, not runtime reproduction:

- `src/App.tsx` now dismisses import toasts, adds decoded tracks before persistence, and keeps pending/failed asset IDs out of autosave snapshots. Browser verification is still required for paint timing and failure/reload behavior.
- `src/waveform/cache.ts` now avoids the full-length mono copy, bounds retained peak arrays to 64 MiB, and aggregates coarser levels from cached finer peaks. A cache miss for a finer level still scans the source; measure cache-miss cost on long files.
- `src/components/Timeline.tsx` now uses a viewport-sized canvas and timeline-coordinate translation. Verify visible clip geometry, horizontal scrolling, resize, and zoom in a browser.
- `src/audio/engine.ts` now recomputes project end on seek and uses a playback request generation to invalidate stale starts. Verify scrubbing while playing, especially repeated seek requests during AudioContext initialization.
- `src/audio/mastering.ts` now uses a monotonic deque for lookahead limiting and local block-based MP3 encoding. The limiter's unit test is added but not run here; audio equivalence, long-export responsiveness, and a network capture remain outstanding.

## Updating status

Change an item to **Done** only when its acceptance evidence is recorded in the PR/commit and the relevant row in `VALIDATION_MATRIX.md` is updated. If investigation disproves a report, record that result and close or rewrite the item rather than implementing a fix for a nonexistent cause.


## Continued correction work (2026-10-23)

- **CS-04 partial implementation:** `src/App.tsx` now stores the latest engine time in `playheadSecondsRef`; React-owned playhead display state is committed no more often than every 100 ms while playing, but immediately when playback is idle or a seek/stop/end callback arrives. Pause commits the exact engine time. Playback start, paste-at-playhead, split-at-playhead, and cut diagnostics read the ref where freshness matters. The track-row playhead line transitions over the 100 ms state interval. This is a mitigation, not closure: no React Profiler/runtime evidence is available, and the ruler canvas still follows React state.
- **Validation:** TypeScript `transpileModule` syntax checks passed for 76 implementation/test `.ts` and `.tsx` files (the `.d.ts` declaration file was excluded because transpileModule does not emit declarations). Global `tsc --noEmit --pretty false` still stops before project checking because `vite/client` is missing. No test, production build, browser, or profiler result is claimed for this continuation.
- **CS-13 is partially implemented, not closed:** `.uuda` v1 now packages referenced audio and project metadata; Save/Save As/Open and keyboard shortcuts are wired, with legacy JSON support. Standalone exact-sample round-trip and targeted type-check passed. Browser validation, full app build, lifecycle/dirty-state handling, per-tab autosave isolation, orphan cleanup, and large-file memory behavior remain open.


## Continued correction work — 2026-10-23 (UUDA project container)

- **CS-13 implementation:** added `src/storage/projectFile.ts` with the PRD's six-byte `UUDAPJ` signature, 32-bit little-endian manifest length, versioned JSON manifest, and raw float32 PCM channel payload. The writer includes only assets referenced by clips and clip version history. The reader refuses unsupported newer versions, preserves legacy JSON reading, reports missing referenced audio, and copies audio from 4 MiB file slices rather than allocating a second full-file ArrayBuffer. The channel offset origin was ambiguous in the PRD; it is now explicitly defined as relative to the start of the PCM payload in `PROJECT_FILE_FORMAT.md`.
- **Project lifecycle:** Save/Save As use the File System Access API where available, with download fallback; Open accepts `.uuda` and legacy JSON; Ctrl/Cmd+S, Ctrl/Cmd+Shift+S and Ctrl/Cmd+O are wired while the studio is active. Save & New/Reset now wait for save completion and respect cancellation.
- **Tests/evidence:** added `src/storage/projectFile.test.ts` for exact stereo sample round-trip, newer-version rejection and missing-asset reporting. A standalone Node harness passed exact two-channel sample and metadata round-trip; targeted strict TypeScript checking passed for the file module and model dependencies; syntax transpilation passed for 78 `.ts`/`.tsx` files. Vitest, full app type-check/build, browser file picker tests, and large-file memory tests remain NOT VERIFIED.
- **Remaining CS-13 requirements:** dirty tracking, beforeunload protection, per-tab autosave isolation, orphaned-audio cleanup, historical binary migrations, and runtime tests. The Blob writer can still create substantial memory pressure on very large projects; no 60-/90-minute claim is made.


### CS-16 — Root project folder selector (batch 3)
- **Status:** Implemented in source; browser validation pending.
- Added Project menu actions to select and persist a root directory handle, save `.uuda` files there by default after selection, and open `.uuda` files from that directory.
- Compatibility fallback remains the existing single-file picker/download path when folder access is unavailable.
- Limitation: this selects the root for portable project files; it does not move IndexedDB autosave/audio assets into that folder. Browser permission restoration, cancel/error paths, and round-trip save/open must be exercised in the supported target browsers.


## Mandatory continuation after PR #20 (2026-10-23)

PR #20 re-applies the waveform cache pyramid, linear-time lookahead limiter, and local bounded-block MP3 encoding to the current mainline contracts. CI passed on candidate SHA `a5360fffe211bfa8807ce124d7cc71c28745d0c1` (run [39909841496](https://github.com/GoReallyBig-GRB/Uudastudio/actions/runs/39909841496)). This is implementation and automated-test evidence only, not browser/audio acceptance.

| Gap | Class | Binding disposition | Required closure evidence |
|---|---|---|---|
| CS-04 playhead/render performance | B | Mandatory next execution; do not call complete | React Profiler trace on representative project; smooth playhead and responsive controls |
| CS-06 waveform cache/viewport performance | B | Mandatory next execution; browser/runtime validation | Cache hit/miss scan timing, memory accounting, viewport geometry and zoom/scroll/resize on long stereo audio |
| CS-09 limiter/export correctness | B | Mandatory next execution; browser/audio validation | Reference output comparison and long-export UI responsiveness/memory record |
| CS-10 / CS-12 export memory and progress | B | Mandatory next execution | Stage timings, peak memory, visible progress throughout export, identified long tasks |
| CS-13 project lifecycle gaps | C | Insert into next execution from PRD scope; not a general backlog item | Dirty-state tracking, beforeunload guard, per-tab autosave isolation, orphan cleanup, version/corrupt-file behavior, and large-file tests |
| CS-00 / CS-15 baseline and 60-/90-minute targets | B | Mandatory next execution; run after safe fixes or in parallel where independent | Named machine/browser/file profile, baseline metrics, agreed target table; no unmeasured guarantees |
| CS-16 root-folder workflow | B | Browser validation remains queued until AI Studio staging is available | Permission persistence, save/open round-trip, cancel/denied/unsupported fallbacks and Save As behavior |
| Cloudflare/hosting cutover | A | Parked as a genuine later task per user direction | Resume only when requested; no deployment work in this correction batch |

B and C items are mandatory next-execution work, not deferrals. Browser-only evidence that is blocked by staging remains explicitly unresolved while safe independent code work continues.


## Continued correction work — 2026-10-23 (WAV export responsiveness)

- Added `exportAudioBufferToWavAsync`: PCM conversion happens in approximately one-second chunks, with progress callbacks and an event-loop yield after each chunk. The existing synchronous encoder remains available for internal acceptance-test paths.
- The async encoder rejects channel counts outside mono/stereo rather than silently writing a malformed/truncated file, sanitizes non-finite samples to zero, checks the RIFF 4 GiB size limit, and validates the final Blob size.
- The export UI now awaits the async encoder and forwards progress updates, so WAV encoding can paint progress and respond between blocks.
- Added unit tests for RIFF/WAVE header fields, stereo 16-bit sample conversion, packed 24-bit samples, progress updates, and unsupported channel counts.
- This reduces large contiguous allocation pressure and main-thread monopolization, but does **not** remove the final encoded Blob's total memory footprint, and mastering/render/verification still hold large buffers. CS-10/CS-12 remain **PARTIAL; runtime NOT VERIFIED** pending CI and named-machine memory/long-task profiling.


## Continued correction work — 2026-10-23 (yielding loudness analysis)

- Added an asynchronous counterpart to the existing loudness/true-peak measurement routine. It preserves the synchronous reference algorithm's filter coefficients, sample iteration, gating and result rounding while yielding during true-peak scans, RMS accumulation, K-weighting, and block gating.
- `measureAndApplyMastering` now awaits yielding pre- and post-mastering measurements, with stage progress ranges.
- Added parity tests comparing sync/async measurement results and a long-analysis progress test.
- This removes several large uninterrupted loops, but still allocates full-length filtered channel arrays and a per-block loudness list. CS-10 remains **PARTIAL** until memory profiling informs whether a streaming/incremental loudness algorithm is necessary; CI and browser performance are pending.


## Continued correction work — 2026-10-23 (bounded-memory loudness filter)

- Follow-up to the yielding analysis work: the async loudness path now filters one channel at a time and retains only a 400ms Float32 ring buffer while calculating overlapping loudness windows. It no longer allocates a full-duration K-weighted Float32Array for every channel.
- Per-window powers are retained for gating/LRA only; original absolute and relative gating behavior is preserved. The synchronous `measureLoudness` remains the comparison reference.
- The existing sync/async parity test is the key correctness gate. This is an implementation candidate until CI confirms exact output parity. True-peak and RMS scans still traverse full input channels, and final export buffers remain in memory; CS-10 remains partial pending profiling.
