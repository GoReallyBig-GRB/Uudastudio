# Batch 6 Beneficial-Work Extraction

**Source branch:** `correction/async-export-verification-batch-6`  
**Integration base:** `main`  
**Reviewed:** 2026-10-23

## Outcome

The useful batch 6 behavior is already present on `main`; this branch starts from `main` so it preserves that integrated implementation instead of replaying an older snapshot over newer fixes.

Verified identical between `main` and batch 6:
- `src/App.tsx`
- `src/storage/projectFile.ts`
- `src/components/MasterExportPanel.tsx`
- `README.md`

The current `MasterExportPanel` already uses yielding loudness analysis for the rendered mix and forwards export progress to exported-blob verification. The project-file and app integration changes are already present as well.

## Beneficial behavior retained from the batch 6 work

- Yielding loudness / true-peak analysis with progress reporting.
- Asynchronous export verification after decoding the exported audio.
- Progress updates during long-running verification and measurement.
- Responsive, chunked WAV encoding and RIFF-size validation.
- Existing regression coverage for sync/async parity, short clips, block/hop boundaries, and long true-peak progress.

These are retained from `main`; they do not need to be copied again from the stale batch 6 snapshot.

## Deliberately not copied

The batch 6 `src/audio/mastering.ts` differs from `main` by retaining full-duration `Float32Array` filtered-channel allocations in its loudness path. That regresses the bounded-memory approach. The newer `main` implementation uses rolling-window processing, so replacing it with the batch 6 version would be a regression.

The batch 6 test file is also older than `main`'s version: `main` includes additional empty/short/block/hop boundary checks and a long true-peak progress check. No tests were removed or replaced.

## Validation status

This document records a source comparison, not runtime acceptance. CI should run on this branch before merging any follow-up changes. AI Studio browser acceptance, long-duration memory profiling, and audio listening/comparison remain runtime gates and are not claimed as passed.
