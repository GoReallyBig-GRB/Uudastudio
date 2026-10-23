# UUDA Project File Format — Version 1

This document records the current implementation against the PRD's binary-container contract. The authoritative requirement is in **Uuda Studio — PRD & Technical Specification**, section 9: a single `.uuda` file containing the full project and referenced audio, with a versioned manifest, exact float32 PCM, a legacy JSON reader, refusal of newer unsupported versions, and a warning rather than a crash for missing audio.

## Byte layout

| Range | Content |
|---|---|
| `0..5` | ASCII magic `UUDAPJ` (six bytes) |
| `6..9` | Unsigned 32-bit little-endian UTF-8 manifest length |
| `10..(10 + manifestLength - 1)` | UTF-8 JSON manifest |
| Following byte | Raw float32 PCM payload, channels stored consecutively |

The manifest contains `app`, `version`, `savedAt`, the complete `project`, and `assets`. Each asset includes `id`, `name`, `kind`, `sampleRate`, `durationSeconds`, `numberOfChannels`, optional `voiceMetadata`, and a `channels` array. Each channel descriptor contains `byteOffset` and `byteLength`.

**Offset convention:** channel `byteOffset` values are relative to the beginning of the PCM payload (the first byte after the manifest), not relative to the file start. The PRD specifies offsets but does not explicitly define their origin; this convention is fixed here so writer, reader, and tests share one unambiguous contract.

## Version 1 behavior

- Audio samples are stored as raw float32 PCM; no compression or third-party archive dependency is used.
- Only audio assets referenced by clips or clip version history are packaged.
- Opening reads the header and manifest separately, then copies PCM into AudioBuffers in 4 MiB chunks to avoid a second full-file ArrayBuffer allocation.
- Legacy JSON projects are still accepted. They do not embed audio, so audio availability depends on the current local asset store.
- Unsupported newer file versions are rejected with a clear error.
- Missing or invalid referenced audio is reported to the caller; the project metadata can still open with a warning.
- Save uses the File System Access API when available and remembers the selected file handle for subsequent saves in the current page session. Save As requests a new destination. Browsers without that API fall back to downloading a `.uuda` file.
- `Ctrl/Cmd+S` saves, `Ctrl/Cmd+Shift+S` invokes Save As, and `Ctrl/Cmd+O` opens the project file picker when the studio is active and focus is not in an editable control.

## Known limits / follow-up

- The writer currently builds a Blob from PCM channel views. The browser may temporarily retain/copy substantial memory for very large projects; this implementation does **not** establish safe 60- or 90-minute export behavior.
- The file handle is session-local and is not restored after a reload. A durable recent-file/handle policy is not implemented.
- Full dirty tracking, a `beforeunload` guard, per-tab autosave slots, and orphaned-audio cleanup remain separate requirements from the PRD and are not closed by the file format implementation.
- Only version 1 is currently supported; no historical `.uuda` binary migration is available because this snapshot contained no earlier project-file implementation. Legacy JSON is handled separately.

## Evidence

- `src/storage/projectFile.ts` implements the writer, reader, version gate, and missing-asset reporting.
- `src/storage/projectFile.test.ts` covers exact stereo float32 round-trip, newer-version rejection, and missing-asset reporting. The Vitest suite has been authored but could not be run without installed dependencies.
- A standalone Node runtime harness successfully round-tripped project metadata, version-history references, and exact sample values across two channels. Targeted strict TypeScript checking of the project-file module and its model dependencies passed. Full application type-check/build and browser testing remain **NOT VERIFIED**.


## Root folder workflow (correction batch 3)

The Project menu now includes **Choose Root Folder** and **Open from Root Folder**. On browsers implementing the File System Access API, the selected directory handle is stored in a dedicated IndexedDB settings database and restored on later visits where browser permissions allow. A normal Save uses the current project file handle if one exists; after selecting a root folder, the current file handle is cleared so the next normal Save creates/updates the project's `.uuda` file inside that root. Save As still opens the browser's file picker. Open from Root Folder lists `.uuda` files in that directory and lets the user choose one.

Folder access is browser-gated and generally requires a secure context and a compatible browser. If unsupported, the app shows an error and existing single-file Save As / Open fallback remains available. The folder picker and persisted permission flow still require interactive browser validation; this implementation does not redirect IndexedDB audio autosave into the selected directory, and it does not recursively scan subfolders. The root folder is currently the default location for portable `.uuda` project files only.
