# Validation Matrix

This is the acceptance checklist for the correction strategy. It is intentionally measurement-led: the 60-/90-minute limits below are **to be agreed and baselined**, not invented as already-achieved guarantees.

## Test profile to record every run

- Commit/hash and build mode
- Browser/version, OS, device RAM, available storage, and power mode
- Audio file format, duration, sample rate, bit depth if applicable, and channel count
- Track count, clip count, enabled effects/plugins, and export format/settings
- Cold or warm cache; IndexedDB state; whether DevTools is open
- Wall-clock duration by stage, peak JS heap/process memory where available, UI long tasks, and whether the tab remains responsive

## Functional and integrity gates

| Gate | Test | Pass condition | Evidence to keep |
|---|---|---|---|
| V-01 Import lifecycle | Import valid file, corrupt/unsupported file, cancel if supported, and retry | No orphaned decoding toast; errors are actionable; no half-created track | Screen recording/log and outcome notes |
| V-02 Long-file seek | Import long audio and seek near beginning, middle, and end before and during playback | Playhead/counter follows requested time; no stale-duration clamp | Test file metadata and timestamps/seeks |
| V-03 Scrub while playing | Repeatedly drag playhead in both directions during playback | No overlapping playback, jumps to zero, runaway sources, or frozen UI | Repro steps and profiler trace |
| V-04 Waveform navigation | Repeated zoom in/out, horizontal scroll, fit-to-window, resize viewport | Waveforms remain visible; no giant canvas failure; visible-region work is bounded | Canvas dimensions and profile |
| V-05 Cache behavior | Zoom repeatedly across several resolutions on long stereo file | No full-source scan on each zoom; cache is bounded and allocation failures are handled | Cache bytes/hit rate and time per zoom |
| V-06 Persistence | Import long audio, wait for save, reload/reopen; test quota/failure where feasible | UI distinguishes playable from persisted; successful reopen preserves audio; failures are visible | IndexedDB/write outcome and reopen result |
| V-07 Export responsiveness | Export WAV and MP3 on reference projects; observe all stages | UI remains interactive and progress advances based on completed work | Stage timings, long-task trace, memory profile |
| V-08 Export audio integrity | Compare duration, channels, sample order, loudness/peak behavior and representative waveform/audio | No unexpected truncation, channel swap, boundary click, or DSP regression beyond approved tolerance | Automated metrics and listening notes |
| V-09 Local-only export | Capture network traffic during local MP3/WAV export | No complete audio payload is uploaded for local export | Sanitized network trace |
| V-10 Project round trip | Save `.uuda`, close/reload app, reopen in a clean session/browser profile where supported | Project state and all referenced audio are present; missing/corrupt data is handled clearly | Package manifest and round-trip result |
| V-11 Recovery | Interrupt persistence/export or reload during work where safely testable | Last valid state remains recoverable; incomplete output is not reported as complete | Recovery scenario and logs |
| V-12 Parallel correctness (later) | Compare serial and 1/2/4-worker exports with effects enabled | Defined numeric tolerance passes; no gaps/clicks/duplicate samples; memory remains bounded | Comparison report and timings |

## Performance target register

Fill these targets after collecting a baseline on a named reference machine. Do not mark a target passed until the measurement and environment are attached.

| Metric | 10-minute project | 60-minute project | 90-minute project | Status |
|---|---|---|---|---|
| Import-to-visible-track time | Measure / set target | Measure / set target | Measure / set target | Open |
| Longest UI task during import/persistence | Measure / set target | Measure / set target | Measure / set target | Open |
| Zoom gesture response | Measure / set target | Measure / set target | Measure / set target | Open |
| Peak memory during import/waveform | Measure / set cap | Measure / set cap | Measure / set cap | Open |
| WAV export wall time | PRD reference: under 2 min offline for stated 10-min project; verify conditions | Measure / set target | Measure / set target | Open |
| MP3 export wall time | Measure / set target | Measure / set target | Measure / set target | Open |
| Peak memory during export | Measure / set cap | Measure / set cap | Measure / set cap | Open |
| Reopen / recovery integrity | Pass/fail | Pass/fail | Pass/fail | Open |

## First correction batch — status (2026-10-22)

Implemented in the working snapshot, but not yet runtime-verified:

- Import toast lifecycle and playable-before-persisted distinction; autosave excludes clips whose audio asset is not yet durably stored.
- Engine seek end recalculation and stale asynchronous playback-start invalidation.
- Viewport-sized timeline canvases, 64 MiB peak-array LRU budget, removal of the full-length mono copy, real fit-to-window calculation, and playhead-follow near the viewport edge.
- O(n) sliding-window limiter with periodic yields and a reference-equivalence test; local block-based MP3 encoding without the server upload path.

**Environment limitation:** the dependency installation attempt timed out. `tsc --noEmit` cannot start project type-checking because `vite/client` is unavailable. Syntax/transpile validation and a separate randomized algorithm comparison passed, but Vitest, full type-check, production build, browser profiling, network capture, IndexedDB recovery tests, and actual mastered-output comparison are still **NOT VERIFIED**. Do not mark V-01 through V-09 as passed until those checks are run in the normal project environment.

### Mandatory next execution

1. Close CS-04: the authoritative playhead now uses a ref and React commits are throttled to at most 10 Hz while playing. This is partial only; profile the result and determine whether a narrow visual update path is required to avoid broad renders and preserve smooth motion.
2. Close remaining CS-06/CS-09/CS-10/CS-12 evidence: long-file waveform cache misses, mastering/reference audio, export memory, and progress responsiveness.
3. Address CS-13: implement and round-trip test the PRD-required self-contained `.uuda` project package with audio. Static inspection confirms the current file handler remains JSON-only; the package gap is open.
4. Capture runtime baseline and establish explicit 60-/90-minute targets before claiming performance acceptance.

## Required regression run after each phase

Run `npm run lint`, `npm test`, and `npm run build` where the repository environment supports them. Record failures that predate the change separately from regressions. Add focused automated tests for logic that can be tested without a browser; keep browser profiling and audio listening checks for behavior that unit tests cannot prove.


## Continued correction work — 2026-10-23

- **CS-04 partial:** playhead time is stored in a ref on every engine callback. React state updates are throttled to 100 ms while the engine is playing and are immediate when playback is idle; pausing explicitly commits the current engine position. This reduces parent renders but is not proven to eliminate expensive whole-tree reconciliation. Syntax/transpile checks passed for 78 `.ts`/`.tsx` implementation and test files; full type-check remains blocked by missing `vite/client`.
- **V-03 / playhead accuracy:** pause now commits the engine's current time rather than leaving the counter up to one throttle interval behind. Split/paste operations use the ref for the current playback position. Browser interaction and React Profiler checks remain NOT VERIFIED.
- **CS-13 / V-10:** `.uuda` v1 writer/reader and standalone exact-sample round-trip now exist; V-10 remains PARTIAL pending Vitest, full app build, browser round-trip, missing/corrupt-asset behavior, and large-file memory checks.


## UUDA file implementation — 2026-10-23

- Standalone runtime harnesses: **PASS** for metadata, version-history reference, and exact float32 stereo samples; missing referenced audio reporting; and refusal of unsupported newer file versions.
- Targeted strict TypeScript check of `src/storage/projectFile.ts`, `src/types/index.ts`, and `src/plugins/types.ts`: **PASS**.
- Syntax/transpile check of 78 implementation/test TS/TSX files: **PASS**.
- Project Vitest, full application type-check, production build, browser Save/Save As/Open, shortcut, cancellation, corrupt-file and large-file memory tests: **NOT VERIFIED** (dependencies are unavailable; full `tsc` stops at missing `vite/client`).
- V-10 remains **PARTIAL** until the full app and browser round-trip passes and missing/corrupt assets are confirmed to warn without crashing.


## Root folder selector — batch 3
- [ ] In a supported secure browser context, choose a folder and confirm its name appears in the Project menu.
- [ ] Reload the app and confirm the folder name is restored; confirm permission prompts are handled safely.
- [ ] Save a project and verify a self-contained `.uuda` file is created in the selected root folder.
- [ ] Open a `.uuda` from the selected root folder and verify tracks and referenced audio restore.
- [ ] Test folder-picker cancellation, denied permission, empty folder, invalid selection, and unsupported-browser fallback.
- [ ] Confirm Save As can still select a different destination and subsequent Save targets that chosen file.
- [ ] Confirm no claim is made that IndexedDB autosave/audio assets are stored in the selected folder.


## Candidate evidence — PR #20 (2026-10-23)

- CI passed on `a5360fffe211bfa8807ce124d7cc71c28745d0c1`: [run 39909841496](https://github.com/GoReallyBig-GRB/Uudastudio/actions/runs/39909841496). Type-check, tests and build steps completed successfully.
- Waveform pyramid unit test and lookahead limiter reference-equivalence tests are included in the candidate and passed in CI.
- Source inspection confirms `exportAudioBufferToMp3` no longer posts a WAV to `/api/export/mp3`; V-09 is still **NOT VERIFIED** until a browser network capture is recorded.
- V-04/V-05, V-07/V-08, V-09 and the 60-/90-minute performance target rows remain **NOT VERIFIED** pending browser profiling, real output comparison, and memory/network evidence.


## Continued correction work — 2026-10-23 (WAV export responsiveness)

- Added async chunked WAV encoding and progress updates to the export UI; unit coverage added for header, PCM sample bytes, 16-/24-bit formats, progress, and channel validation.
- CI and runtime evidence for this change: **PENDING** at commit creation. Even after CI passes, V-07 remains **NOT VERIFIED** until a browser profile records export stage timings, peak memory, long tasks, and responsiveness for reference projects.
- Chunking prevents a single full-size contiguous PCM ArrayBuffer and yields between blocks. It does not make total WAV bytes disappear from memory; Blob parts remain retained until download, so the agreed memory cap still needs measurement.


## Continued correction work — 2026-10-23 (yielding loudness analysis)

- Added `measureLoudnessAsync` with yielding true-peak, RMS, K-weighting, and gating passes, then routed the mastering pre/post analysis through it.
- Automated parity and progress tests added. CI status: **PENDING** for this candidate.
- Memory is not yet bounded: the K-weighted channel buffers and loudness-block arrays remain full-duration allocations. V-07 remains **NOT VERIFIED** until a browser profile records stage timings, peak memory, long tasks and responsiveness.


## Continued correction work — 2026-10-23 (bounded-memory loudness filter)

- Async loudness analysis now computes K-weighted samples into a 400ms ring and accumulates each overlapping window without storing full-length filtered audio.
- Sync/async parity test must pass before merge. CI: **PENDING** for this candidate.
- This bounds the K-weighting intermediate but does not bound the rendered/mastered AudioBuffers or final encoded Blob. V-07 and the 60-/90-minute targets remain **NOT VERIFIED** pending named-machine runtime profiling.


## Merge reconciliation — 2026-10-23

Implementation merges: [PR #20](https://github.com/GoReallyBig-GRB/Uudastudio/pull/20), [PR #21](https://github.com/GoReallyBig-GRB/Uudastudio/pull/21), [PR #23](https://github.com/GoReallyBig-GRB/Uudastudio/pull/23), [PR #24](https://github.com/GoReallyBig-GRB/Uudastudio/pull/24), and [PR #25](https://github.com/GoReallyBig-GRB/Uudastudio/pull/25). CI passed for each candidate before merge. No browser profiling, audio listening/equivalence on real exports, long-file memory run, or AI Studio staging test is claimed from those CI results.

**Current priority:** establish a reproducible browser baseline and run V-04/V-05, V-07/V-08/V-09, V-10/V-11, and the root-folder checks in AI Studio when staging becomes available. Until then, continue safe code-level work and keep CS-00/04/06/09/10/12/13/15/16 open or partial.

## Reconciliation addendum — 2026-10-23

- Async loudness analysis now uses a bounded rolling squared-sample window and counts only valid, hop-aligned windows. Short non-empty clips are analyzed with one effective window no longer than the clip.
- Regression coverage includes empty/short clips, 400 ms block boundaries, 100 ms hop boundaries, async/sync parity, and progress during long true-peak scans.
- Export verification progress is forwarded to the export progress UI.
- Automated checks and browser/runtime memory measurements must be recorded from the resulting candidate before this correction is considered complete. No unperformed browser or long-duration memory test is claimed as passed.

## Consolidated open-task execution branch — 2026-10-23

Branch: `correction/open-partial-tasks`, based on main commit `51df2b8241a855ee4e16be7b8865752d1524bcb5`.

### Added automated coverage (execution pending)

- `src/audio/masteringExport.test.ts`: asynchronous 16-/24-bit WAV output byte-for-byte parity with the synchronous encoder, RIFF/data size fields, monotonic block progress, unsupported channel count rejection, and RIFF 4 GiB overflow rejection before channel reads.
- These tests were authored on the branch; this environment did not provide a usable network connection for a fresh clone, and no claim is made that Vitest, full type-check, or production build has passed for this branch.

### Outstanding acceptance evidence (still required)

| Scope | Required next evidence | Status |
|---|---|---|
| CS-00 / CS-15 | Named-machine baseline and agreed 60-/90-minute metrics/caps | OPEN |
| CS-04 | React Profiler trace; seek/scrub/playback interaction recording | PARTIAL |
| CS-06 / V-04 / V-05 | Long stereo-file zoom/scroll timings, canvas dimensions, cache hits/bytes | PARTIAL |
| CS-09 / V-08 | Reference-output comparison, loudness/true-peak measurements and listening notes | OPEN |
| CS-10 / CS-12 / V-07 | Stage timing, peak memory, long-task trace and progress responsiveness | PARTIAL |
| V-09 | Sanitized browser network capture confirming local export sends no full audio payload | NOT VERIFIED |
| CS-13 / V-10 / V-11 | Browser `.uuda` round trip, missing/corrupt audio, interrupted save/recovery, quota failure | PARTIAL |
| CS-16 | Folder permission restoration/cancel/error and save/open round trip in supported browser | PARTIAL |
| CS-14 / V-12 | Serial-vs-worker correctness and memory benchmark after baseline | DEFERRED |

Run `npm run lint`, `npm test`, and `npm run build` in the normal dependency-complete environment. Preserve CI logs and browser profiles with commit hash, browser/OS/RAM, audio duration/channels, track/clip count, and cold/warm cache state. Never mark browser/audio/performance gates passed from source inspection or unit tests alone.


## Additional regression coverage — session recovery safety

- [x] Pure unit test: distinct per-tab IndexedDB project keys.
- [x] Pure unit tests: snapshots within the recovery window are retained; stale/missing/invalid timestamps are expired.
- [ ] IndexedDB integration: expired snapshots are deleted before orphan asset collection.
- [ ] Multi-tab browser check: an active tab's snapshot/assets remain intact while a stale tab's snapshot expires.
- [ ] Persistence failure check: autosave omits clips whose active asset is not durable and strips version-history references to unsaved assets.
- [ ] Slow-storage check: autosave does not queue overlapping writes or overwrite a newer snapshot with an older one.
- [ ] Browser recovery check after suspended-tab resume and quota/storage failure.

The checked items above describe added unit-test coverage. Latest branch CI passed at commit 5004d36ff10e751348e3cd74d412e646e71d1b16 (type-check, tests, application/server build). Browser and IndexedDB transaction acceptance remains open.

- [ ] Browser quota/permission failure check: verify a persistent warning appears once during a failure streak and clears its latch after a successful autosave.

- [ ] IndexedDB restore failure check: force a read/open failure and verify the app warns, pauses autosave, and does not overwrite an existing recovery snapshot with the blank fallback.

- [ ] Large `.uuda` open check: confirm timeline becomes available before IndexedDB asset writes finish; verify failed writes warn and recovery autosave omits non-durable audio references.

- [x] Added automated cases for truncated UUDA PCM payload and invalid manifest length; run them in branch CI before handoff.

- [ ] Dirty-state browser check: manual timeline refresh alone must not trigger an unsaved-project prompt; actual edits must still trigger it until a portable save succeeds.

- [ ] Open-loss prevention: with unsaved edits, cancel the replacement confirmation and verify the active project remains unchanged; confirm replacement only after explicit approval.

- [ ] Project replacement undo isolation: create edits, open a different project (or create a new blank one), and verify Undo cannot restore clips/tracks from the previous project.

## Browser feedback regression coverage

- [x] Unit test: true-peak analysis progress advances on a long sample buffer.
- [x] Unit test: waveform cache reuses an existing coarser peak level instead of rescanning the source on zoom-in.
- [ ] Browser: import a 57-minute recording and verify loading status remains visible while the UI stays usable.
- [ ] Browser: zoom in/out repeatedly on a long track; verify waveform remains visible and playhead position stays aligned.
- [ ] Browser: process long-file mastering and verify progress advances past true-peak measurement without locking the app.
- [ ] Browser: generate a TTS voiceover, audition it, place it on a new timeline track, and reload to check persistence warnings.
- [ ] Browser: first-use folder banner appears without requesting microphone access; folder selection persists/reconnects as supported by the browser.
- [ ] Browser: confirm plugin enhancement is present compared with the last known-good version.


Latest browser-feedback follow-up CI passed at commit `4f9c2945322882c9e63f661d52435757826598f7`: type-check, tests, and application/server build all passed. This is automated validation only; the browser acceptance items above remain unchecked until re-tested.


## Mastering and zoom hardening follow-up

- [x] Unit test: optimized async true-peak calculation matches synchronous reference on a representative signal.
- [x] Unit test: progress reporter never moves backwards across nested mastering stages.
- [x] Unit test: loudness-analysis progress is monotonic across true peak, RMS, filtering and gating phases.
- [x] Unit test: zoom anchoring clamps offsets and handles invalid geometry without NaN.
- [ ] Browser: process the same 57-minute project; verify true-peak analysis completes, progress remains monotonic, and offline-render elapsed feedback continues until the effect graph completes.
- [ ] Browser: repeat zoom in/out at different scroll positions while playing and stopped; verify waveform and playhead remain aligned and playback remains stable.
- [ ] Performance profile: measure mastering time and peak memory for 57-/60-/90-minute projects. If processing or memory remains excessive, move heavy offline DSP into a Web Worker and implement OPFS-backed large-file streaming per PRD before considering WASM/native ports.
- [ ] Product decision: specify whether “installable DAW” means installable PWA first or a native desktop package; do not mark desktop packaging complete until target platforms and file/audio permissions are defined.

- [x] Existing sync-vs-async loudness tests cover short clips and block/hop boundaries after the rolling-window implementation changed.
- [ ] Profile CPU time for true-peak, RMS, K-weighting, gating, OfflineAudioContext rendering, and limiter separately on the 57-minute reference file.

- [x] Existing limiter reference-equivalence tests cover short, boundary, empty, and peak-heavy signals after block-loop/index changes.
- [ ] Browser: confirm fractional limiter progress visibly advances during the 57-minute mastering run and does not regress between channels/stages.

- [x] Unit test: long limiter pass emits fractional, monotonic progress and reaches the end of the limiter stage.
