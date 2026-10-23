# Uuda Studio — Correction Strategy

**Status:** Active engineering plan; findings are not all runtime-verified.  
**Purpose:** One stable place to track the long-audio reliability correction work, the order of changes, and the evidence required to call each correction complete.

## Read these in order

1. [Implementation strategy](./IMPLEMENTATION_STRATEGY.md) — why the work is ordered this way and the change sequence.
2. [Correction register](./CORRECTION_REGISTER.md) — issue IDs, repository touchpoints, dependencies, and completion criteria.
3. [Validation matrix](./VALIDATION_MATRIX.md) — repeatable checks and measurable gates, including the still-open 60-/90-minute targets.
4. [Project file format](./PROJECT_FILE_FORMAT.md) — the `.uuda` v1 binary layout, offset convention, lifecycle behavior, and known limits.

## Governing rule

**Measure first, correct the smallest verified cause, and preserve audio/data correctness.** Do not begin a speculative rewrite or parallel-rendering project before profiling the existing path. Treat the reported causes as strong hypotheses until code inspection and repeatable tests confirm them.

## Current repo anchors

- Import and seek orchestration: `src/App.tsx`
- Audio clock, playback, and seek behavior: `src/audio/engine.ts`
- Timeline drawing and viewport behavior: `src/components/Timeline.tsx`
- Waveform peak generation/cache: `src/waveform/cache.ts`
- Master export orchestration/UI: `src/components/MasterExportPanel.tsx`
- Mastering DSP: `src/audio/mastering.ts`
- MP3 server endpoint: `src/server/audioJobs.ts` and its caller(s)
- IndexedDB asset persistence: `src/storage/db.ts`
- Self-contained project container: `src/storage/projectFile.ts` and `PROJECT_FILE_FORMAT.md`

These are investigation starting points, not a claim that every reported bug has already been reproduced or that each file is the sole cause.

## Definition of done

A correction is not complete because the UI looks better once. It must pass the relevant validation checks in [the matrix](./VALIDATION_MATRIX.md), record test conditions and measurements, and preserve project/audio integrity. Keep unresolved browser/runtime measurements explicitly open.


## Batch 3 addition

The integrated correction snapshot adds the root project folder selector and root-folder open/save workflow. See `PROJECT_FILE_FORMAT.md`, correction register CS-16, and the root-folder section in `VALIDATION_MATRIX.md`. This is source-implemented but still requires interactive browser verification.
