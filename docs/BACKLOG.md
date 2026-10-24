# Uuda Studio backlog

One list of everything to build, in order, so nothing gets skipped. Source documents: `docs/ZERO-COST-HOSTING-PLAN.md` (hosting, performance, voice, guest design), the PRD (`Uuda Studio — PRD & Technical Specification`, section 5 requirement IDs), `docs/PLUGIN-HARDENING.md`, and `docs/correction-strategy/VALIDATION_MATRIX.md`.

## How to use this list

- **Order matters.** Work top to bottom by epic unless an item says it can run in parallel. Do not start an item whose dependencies are not Done.
- **Status values:** `Todo`, `In progress`, `Built` (merged, checked by type-check, tests and CI only), `Verified` (also checked by a person in a real browser or device, with notes), `Parked`, `Blocked`.
- **An item is Done only when it is Verified.** `Built` is not done. Evidence (what was tried, on which device and browser) goes in the item's row or a linked note.
- **Definition of done for every item:** type-check and tests pass in CI; new behaviour has tests where the code can be tested without a browser; acceptance line below is shown to pass by a person on the listed devices; docs and this backlog updated; nothing marked ⚠ in the plan left unconfirmed without a note.
- **Merge rule:** branch from the latest `main` (AI Studio pushes there), run CI, merge as a normal merge commit; never merge an older branch separately once an integration branch carries it.
- **Size:** S = days, M = about a week or two, L = several weeks. Relative, not promises.
- **Zero-cost rule:** no item may require a billing account or card. If one would, stop and raise it.

Device set for "Verified" (confirmed by the owner 2026-10-24): one **Windows laptop**, one **Android phone**, one **iPhone**. Browsers per device: Chrome and Edge (and Firefox if installed) on Windows, Chrome on Android, Safari on iPhone.

**Known gaps in that set:** there is no Mac, so **desktop Safari cannot be marked Verified**; the iPhone covers Apple's engine for mobile only, and desktop Safari stays "Works with limits, unverified" until someone with a Mac checks it. There is no low-memory device, so low-memory limits come from measured numbers on the Android phone and from the pre-flight estimates, and the tiers must say so. Record the exact model, OS and browser version of each device in the item's evidence.

---

## Epic 0. Browser and device guidance (first, as requested)

Users must know where Uuda works best and where it will be limited, before they lose work.

| ID | Item | Size | Depends on | Acceptance |
|---|---|---|---|---|
| BR-1 | **Capability check** on load: AudioWorklet, MediaDevices (microphone), WebRTC, File System Access (save-as picker), origin-private storage, WebCodecs audio, WebGPU, `navigator.deviceMemory`, hardware threads, storage quota, touch-only device, and whether we are inside an **in-app browser** (WhatsApp, Instagram, Facebook, TikTok and similar webviews) | S to M | none | Returns a typed result; unit-tested with mocked browsers; no feature is assumed from the browser's name alone |
| BR-2 | **Support tiers** (copy in section below) mapped from BR-1: Best, Works with limits, Not recommended, Not supported | S | BR-1 | Each tier has plain-language text and the limits that apply (e.g. "Save downloads a file instead of saving in place") |
| BR-3 | **First-run notice** and a permanent "Browser and device" help page. Shown once per browser profile, dismissible, always reachable from Help | S | BR-2 | A person on each device in the device set sees the right tier and wording |
| BR-4 | **Warnings at the moment of risk**, not only at start: importing a long file on a limited device, saving on a browser without the save picker, starting a guest recording on a phone | S | BR-2, P-1 | Warning appears before the action, offers a clear choice |
| BR-5 | **In-app browser detection** with an "Open in your browser" instruction (important for guest links opened from WhatsApp) | S | BR-1 | Opening a guest link inside a WhatsApp or Instagram webview shows the instruction instead of a broken microphone prompt |
| BR-6 | Browser matrix kept in `docs/` and updated when tests show a change; thresholds from measurement, not guesses | S | BR-2, benchmark | Matrix cites the test run that justified each tier |

**Starting tier table (to be corrected by testing, every row ⚠ verify on real devices):**

| Tier | Examples | What the user is told |
|---|---|---|
| Best | Desktop Chrome, Edge, Brave, Opera, Vivaldi (Chromium) on a laptop or desktop with enough memory | Full editor, save in place, streaming import and export when built |
| Works with limits | Desktop Firefox, desktop Safari | Editor works; saving downloads a file instead of saving in place; long files and some features may be limited; recommend Chrome or Edge for long projects |
| Mobile / tablet | Android Chrome; any browser on iPhone and iPad (all iOS browsers use Apple's engine) | Guest recording and review work; the full editor is **not recommended** on a phone (memory and screen) |
| Not recommended | Low-memory devices, very old browsers, in-app webviews | Clear warning, with "open in Chrome or Safari" for webviews |
| Not supported | Internet Explorer, browsers without microphone capture or AudioWorklet | Plain message; nothing breaks silently |

---

## Epic 1. Release safety and housekeeping (do before new features)

| ID | Item | Size | Depends on | Acceptance |
|---|---|---|---|---|
| RS-1 | **Real-browser check of everything already merged** (plugin rack, pop-outs, preview, ducking, plugin undo, templates, account template sync, missing-plugin behaviour, save/open with plugin chains) | M | none | Checklist run on the device set; every failure logged as its own backlog item; nothing marked Verified without notes |
| RS-2 | Merge the plan branch (`plan-zero-cost-hosting`) so the plan and this backlog live in `main` | S | none | PR merged, CI green |
| RS-3 | Delete merged and superseded branches (stage-3, 4, 5, 7, 8, 9) after tagging tips | S | RS-2 | Only live branches remain |
| RS-4 | Delete the unused FFmpeg server routes and related tests and docs (`/api/audio/*`, `/api/export/mp3`, `ENABLE_AUDIO_JOBS`) | S | none | Build and tests pass; nothing in the client referenced them |
| RS-5 | **Plugin hardening PL-3**: hash-pinned catalogue, loader hash check, approval tab with step-up code, remove host allow-list and custom-URL form, content-security policy, sandboxed plugin UI (`docs/PLUGIN-HARDENING.md`) | L | none (parallel) | A plugin whose file hash changes is refused; admin approval required; checklist in the doc fully ticked. **Release blocker** |

## Epic 2. Guest invite (zero cost), design in plan section 10

Backlog order follows plan section 10.6. All guest screens are **mobile-first** (see Epic 3).

| ID | Item | Size | Depends on | Acceptance |
|---|---|---|---|---|
| GI-1 | Guest link model: token (128-bit), expiry, use limit, revoke, mode (Offline / Live), script text with director notes and target duration (GM-14); "Invite guest voice" on a track | M | RS-1 | Link created, copied, revoked; expired link shows a clear message |
| GI-2 | `/join/<token>` page shell (no sign-in), session name and script preview (opens the full-screen script view, GM-11) | S to M | GI-1, BR-5 | Opens on phone and desktop; in-app webview shows the open-in-browser notice |
| GI-3 | Guest capture: microphone permission flow, device choice, level meter, record raw audio to a WAV with chunks saved to origin-private storage as it records | M to L | GI-2 | A 10-minute recording survives a tab reload; file plays back correctly; no dropped chunks |
| GI-4 | Preview, re-record, discard; trim silence ends optional | S to M | GI-3 | Guest hears the exact take that will be sent |
| GI-5 | **Manual file send (path C):** download the WAV with a clear filename, instructions to send it | S | GI-3 | File opens in Uuda and in a normal audio player |
| GI-6 | Producer inbox: drop a received file or take onto the timeline as "Guest: <name>", resampled to the project rate, with script and notes | M | GI-5 | Take lands on the right track at the right rate, no pitch or speed shift (RC-3) |
| GI-7 | Signalling service: Cloudflare Worker with one Durable Object per room, plus an Express twin for AI Studio staging; same message protocol | M | GI-1 | Two browsers exchange offers through either transport; daily request use measured against the free cap |
| GI-8 | **Direct delivery (path A):** WebRTC data channel from guest to the producer's open tab, chunked with progress and resume | M to L | GI-7, GI-6 | Take of 5 minutes arrives intact (checksum) across two devices on different networks |
| GI-9 | Delivery state machine and honest status ("sent", "waiting for producer", "not sent: here is why"); automatic fall back to C | M | GI-8 | Never shows sent when it was not; tested by cutting the connection mid-send |
| GI-10 | **Live room** (mesh, up to 4): join, mute, connection state, headphone and network advice, consent notice that everyone is recorded locally | L | GI-7, GI-3 | Four browsers talk with acceptable latency on mid-range devices; measured |
| GI-11 | Live room double-ender: each person records locally, takes delivered by A/C after the session, with start offsets and optional sync beep | L | GI-10, GI-8 | Four takes align on the timeline within an agreed tolerance |
| GI-12 | **Producer-owned storage (path B):** S3-compatible bucket, keys kept only in the producer's browser, time-limited upload URLs carried in the invite, bucket setup guide (R2, B2) | M to L | GI-9 | Guest uploads while the producer is offline; the take appears later; keys never leave the browser |
| GI-13 | TURN fallback once free terms are confirmed ⚠; otherwise document and keep manual fallback | M | GI-8 | Connections across strict networks succeed, or the app explains and falls back |
| GI-14 | Safety: size and duration caps, audio-only check, decode in a worker, per-link rate limits, token hashing | M | GI-8 | Abuse tests pass (oversized, wrong type, replayed link) |
| GI-15 | Live streaming to many listeners | L | GI-10 | **Parked** until scoped; needs a media relay and a free-tier check |

## Epic 3. Mobile guest experience (applies to every guest screen, GI-2 onward)

Phones are the main guest device, so the guest UI adapts to what a phone can do, not just to its screen.

| ID | Item | Size | Depends on | Acceptance |
|---|---|---|---|---|
| GM-1 | **Mobile-first layout:** single column, large touch targets (at least 44 px), no hover-only controls, safe-area insets, works in portrait and landscape, readable script text with adjustable size | M | GI-2 | Walkthrough on a small Android and an iPhone with no horizontal scroll or clipped buttons |
| GM-2 | **Phone-sized recording defaults:** mono, 16-bit, 44.1 or 48 kHz (device rate), no 24-bit option on phones; shows the file size estimate and a "send on Wi-Fi" hint | S | GI-3 | A 10-minute recording stays within a stated size and memory budget on a mid-range phone |
| GM-3 | **Keep recording alive:** screen wake lock where supported, warning not to lock the screen or switch apps, recording state saved in chunks so an interruption (call, switch, low battery) can be resumed | M | GI-3 | Interrupt test: incoming call and app switch during recording leave a recoverable take |
| GM-4 | **iPhone-specific handling** (audio context needs a tap, fixed sample rate, background suspension, no save picker): tested path with a clear fallback message | M | GI-3, BR-2 | Records, previews and sends from Safari on iPhone |
| GM-5 | **Android-specific handling** (Chrome and Samsung Internet, permission prompts, low-RAM devices) | S to M | GI-3 | Same on a low-memory Android |
| GM-6 | **Data and battery awareness:** show upload size, use resumable chunks, pause and resume on network change, offer to send later | M | GI-8 | Switching Wi-Fi to mobile data mid-send resumes without restarting |
| GM-7 | **Cap recording length by device** (from measurement) and warn before the cap; allow splitting into takes | S to M | GI-3, P-1 | A long take on a phone is split or stopped safely, never lost |
| GM-8 | Accessibility basics: labels, focus order, contrast, screen-reader names on record controls | S | GM-1 | Checked with a screen reader on one phone |
| GM-9 | Low-bandwidth friendliness: the guest page loads small (no editor code) and works on slow connections | M | GI-2 | Page weight budget set and met; loads on a throttled connection |
| GM-11 | **Script view:** for scripted offline takes, one tap on the script preview opens a **full-screen, scrollable script**; one tap brings back the full recording screen. Switching is instant and animated, never interrupts the recording (recording state lives outside the screen, so nothing is unmounted), and keeps the scroll position in both directions. Taps are told apart from scrolls (touch-slop) so scrolling never toggles the view by accident | M | GI-3 | On the iPhone and Android phone, 20 switches during a recording lose no audio, drop no frames of the level meter, and never stop the take |
| GM-12 | **Timing display, visible on both screens:** record indicator, elapsed time, and remaining time against a target (producer-set, or estimated from the script's word count at an assumed pace the guest can adjust); shows ahead or behind pace as a calm cue, not an alarm | S to M | GM-11, GI-1 | Timer matches the recorded file length to within a small tolerance; stays readable in the full-screen script view |
| GM-13 | **Script reading comfort:** adjustable text size, light or dark background, line spacing, current-line highlight; optional **auto-scroll** (teleprompter) with speed control and pause by tap; portrait and landscape | M | GM-11 | A 500-word script is comfortably readable at arm's length on a phone; auto-scroll can be paused and resumed without losing the place |
| GM-14 | **Script format from the producer:** plain text with sections, and **director notes in brackets** shown in a different style and **not counted as words to read**; producer can set a target duration; preview of how it will look on a phone | M | GI-1 | Notes render differently from spoken lines; word count and estimate ignore notes |
| GM-15 | **Take markers:** one tap during recording drops a marker (for a retake or a flubbed line) saved with the take; markers sent to the producer and shown on the timeline ruler | S to M | GM-11, GI-6 | Markers appear at the right times on the producer side |
| GM-16 | **Accidental-stop protection:** stop control large but guarded (press and hold, or confirm) in both views; screen-off and orientation changes never end a take | S | GM-11, GM-3 | Pocket-touch test does not stop a recording |
| GM-10 | Live room on phones: audio only, headphone advice, battery warning, simple mute and leave | M | GI-10 | Phone joins a four-person room and stays stable for the test length |

## Epic 4. Performance and long-audio (plan section 5; target 3 to 4 hour files)

| ID | Item | Size | Depends on | Acceptance |
|---|---|---|---|---|
| P-0 | **Benchmark harness in CI** (Playwright): import, waveform, zoom, scroll, export at 10, 60 and 90 minutes; records time, long tasks and memory | M | none | Baseline stored; budgets set from it |
| P-1 | **Pre-flight size check** on import with warn, downmix, split or cancel choices | S to M | BR-1 | A file that would exhaust memory is stopped with guidance, not a frozen tab |
| P-2 | Bounded waveform cache and viewport-limited canvases | M | P-0 | Memory flat as the timeline grows |
| P-4 | Web Workers for peaks, MP3 encode, loudness | M | P-0 | UI long tasks under the budget during those jobs |
| P-6 | **Streaming import, playback and export** (windowed decode, precomputed peaks, non-destructive clips, chunked export) | L | P-0, P-2, P-4 | A 3 to 4 hour file imports, plays, seeks and exports within the memory budget on the "Best" tier |
| P-3 | Optional downmix or lower rate for long speech | M | P-1 | User can opt in; quality note shown |
| P-5 | Chunked export with bounded memory | L | P-6 | Export peak memory independent of project length |
| P-7 | Capability tiers wired to limits (published supported length per tier) | S | P-0, BR-2 | Published numbers match measurements |
| P-8 | Fill the performance register in `VALIDATION_MATRIX.md` with real numbers | S | P-0 | No "Open" rows left without a reason |

## Epic 4B. Saving, backup and recovery (decided 2026-10-24: files are the durable copy, the browser is only a short safety net)

Finding behind this epic: the browser store (IndexedDB) restores a project only if it was saved within the last **5 minutes** (`MAX_SESSION_AGE_MS`); the 24-hour figure is only a grace period before unused audio is deleted, not a feature. Every import, recording, voice take and clip-processing result is also written in full to IndexedDB at the moment it is created (about 11 call sites in `App.tsx`), which doubles disk use and blocks on large files. No automatic backup to a file exists today. Browser storage can also be evicted by the browser, so it must never be the long-term copy.

| ID | Item | Size | Depends on | Acceptance |
|---|---|---|---|---|
| PS-1 | Shorten the unused-audio grace period from 24 hours to about 1 hour (it only protects an in-flight import from another tab) | S | startup fix merged | Orphaned audio disappears within the hour; no race with a second tab in a test |
| PS-2 | **Incremental backup (owner decision 2026-10-25: write chunks until the whole project is saved, then only what is new; never rewrite old material).** Optional, off by default, per project. Backs up into a project **backup folder** of immutable files: audio is written once, in chunks (for example 8 to 16 MB), and a small project checkpoint is rewritten each run. Details in the design note below | L | RS-1 | First backup of a large project completes in chunks and can be stopped and resumed without redoing finished chunks; later runs write only new audio plus the small checkpoint; a 1 GB project with one new 30-second recording writes about that recording, not 1 GB |
| PS-3 | Browsers without folder access (Firefox, Safari, phones): the same incremental store kept in the browser's origin-private storage (survives reloads, not guaranteed against eviction) plus a periodic reminder to **export a `.uuda`**; no silent downloads | M | PS-2, BR-2 | Reminder appears at the chosen interval when the latest backup is not exported |
| PS-4 | **Recovery prompt**: on launch, if a recent unsaved session exists, ask "Recover unsaved session?" with project name and time, instead of restoring silently or not at all | S to M | none | User can recover or discard; discarded audio is released |
| PS-5 | Show storage used by the browser store, a "clear stored session audio" action, and request persistent storage so the browser is less likely to evict | S | none | Numbers shown without loading audio; clearing works |
| PS-6 | **Retire full audio copies in the browser store** once streaming import lands: keep the original file on disk (file handle or origin-private storage) and peaks, not a 32-bit float copy; irreplaceable audio (recordings, voice takes) is protected first | L | P-6 | A 3 to 4 hour import writes no multi-gigabyte float copy to the browser store |
| PS-7 | **Backup bundle tools:** open a project directly from its backup folder, and **export a single `.uuda` from the bundle** by streaming (never holding the whole project in memory); optional **tidy** step that removes audio no checkpoint or undo state still references | M | PS-2 | Export from a 4-hour bundle produces a `.uuda` that opens identically; tidy never deletes audio the latest checkpoint needs |
| PS-8 | Backup integrity: each chunk has a size and checksum in the journal; the journal entry is written only after the chunk is fully on disk, so a crash mid-write leaves a clean resume point; a "verify backup" action | M | PS-2 | Killing the tab mid-chunk and reopening resumes at the right chunk with no corrupt file |
| PS-9 | Backup runs in the background without hurting the editor: worker thread, throttled disk writes, paused during recording, playback scrubbing and export, shows progress and "last backed up" | M | PS-2, P-4 | Editor stays inside the interaction budget while a first backup of a large project runs |

**Incremental backup design (PS-2).**

- **Why a folder of files, not one growing `.uuda`.** The browser's file-writing call copies the whole existing file before changing it when you ask to keep existing data, so appending to a multi-gigabyte single file would rewrite it every time. Many small immutable files avoid that: a new file is created, old ones are never touched.
- **Why "only new" is safe.** Audio assets are immutable. Every import, recording, voice take and clip-processing result becomes a **new asset with its own id**; nothing edits an existing asset in place. So an asset already in the backup never needs writing again.
- **Layout:** `<project>/backup/assets/<assetId>/part-0001.pcm, part-0002.pcm ...`; `<project>/backup/journal.json` (list of completed parts with sizes and checksums); `<project>/backup/checkpoint-<n>.json` (the project: tracks, clips, plugins, settings; small); only the last few checkpoints are kept. The disk cost is **one copy of the audio plus a few small checkpoints**, which answers the rolling-copies question: rolling applies to the small checkpoint only, never to audio.
- **First backup:** walks the referenced assets, writes missing parts in chunks in the background, and updates the journal after each part. Not marked complete until every referenced asset is fully written. It can be paused or interrupted and resumes where it stopped.
- **Later runs:** compare the project's referenced assets against the journal, write only missing assets or parts, then write a new checkpoint. If nothing changed, write nothing.
- **Interval:** this now only controls how often new material and a checkpoint are flushed, so it can be short. Options: after edits settle (continuous), 1, 5, 10, 30 minutes, or off.
- **Restore:** open the backup folder directly, or export one `.uuda` from it (PS-7). The single-file `.uuda` stays the portable, user-initiated Save.
- **Garbage:** audio no longer referenced stays until the user runs "tidy", because undo history (60 levels) can still need it.
- **The same idea for the browser safety net:** once long-file streaming lands (P-6, PS-6), the browser store should hold the same chunked, write-once parts and not a duplicate float copy.

## Epic 5. App-wide testing (as requested, after Epic 2 features exist)

| ID | Item | Size | Depends on | Acceptance |
|---|---|---|---|---|
| TS-1 | Run `VALIDATION_MATRIX.md` gates V-01 to V-11 on the device set; record results | M | RS-1 | Each gate Pass, Fail or Not applicable, with evidence |
| TS-2 | End-to-end browser tests for the main flows (import, edit, undo, plugins, templates, export, save and reopen) | M to L | P-0 | Run in CI on Chromium |
| TS-3 | Regression checks for audio integrity: export length, channels, loudness, round trip | M | TS-2 | Golden files pass |
| TS-4 | Guest flow tests (offline, live) on the iPhone and Android phone, including the interruption, script-view switching and in-app-browser cases | M | GI-12, GM-* | Evidence per phone |
| TS-5 | Cross-browser pass (Firefox, Safari) with the limits listed | M | BR-6 | Matrix updated |
| TS-6 | Security review of guest and plugin surfaces | M | GI-14, RS-5 | Findings fixed or tracked |

## Epic 6. UI optimisation (as requested, after testing finds the problems)

| ID | Item | Size | Depends on | Acceptance |
|---|---|---|---|---|
| UI-1 | Collect UI issues from RS-1 and TS-1 into this list, ranked | S | RS-1 | Each issue has an ID and a screenshot or note |
| UI-2 | Responsiveness pass on the main editor at laptop, tablet and phone widths (editor on phone stays "view and review") | M | UI-1 | No clipped controls at the supported widths |
| UI-3 | Modal and sidebar consistency (rack, templates, voice, effects, export panel) | M | UI-1 | Same patterns for close, scroll and keyboard |
| UI-4 | Performance-driven UI changes (lazy panels, fewer redraws) | M | P-0 | Interaction budgets met |
| UI-5 | Empty, loading and error states reviewed everywhere | S to M | UI-1 | Every async action has all three |

## Epic 7. Hosting at zero cost (plan sections 3, 4, 8)

| ID | Item | Size | Depends on | Acceptance |
|---|---|---|---|---|
| HS-1 | Verify free-tier limits and card requirements for each service (Workers, Durable Objects, TURN, R2, Firebase Spark) from current pages; record sources | S | none | Limits table in the plan has sources, no ⚠ left |
| HS-2 | Static front end on Cloudflare (free), no API origin required for the first release | S to M | HS-1 | Site loads; no billing account anywhere |
| HS-3 | Freesound proxy Worker (credentials stay server-side) | S to M | HS-2 | Search and download work; no secret in the bundle |
| HS-4 | Update `docs/cloudflare-deployment.md` to the zero-cost plan | S | HS-2 | Doc no longer assumes Cloud Run |
| HS-5 | Template and sign-in routes on Workers; Firebase Auth and Firestore on the free Spark plan | L | HS-2 | **After first release**; sign-in and cloud templates work with no Node server |
| HS-6 | Turn off Cloud Run and any billed service | S | HS-5 | No dependency on a billed service |

## Epic 8. Plugins and engine leftovers (earlier items that were not done)

| ID | Item | Size | Depends on | Acceptance |
|---|---|---|---|---|
| EN-1 | Real-time capture fallback for plugins that cannot render offline (PRD 13.4) | M | RS-1 | Export reports and falls back instead of skipping silently |
| EN-2 | Plugin latency compensation across tracks (PRD 13.4) | M | RS-1 | Tracks stay aligned with plugins that add delay |
| EN-3 | Template rename and richer per-user template management | S | RS-1 | Rename works and syncs |
| EN-4 | PRD items to check against the code and either mark Built or add here: TL-4 slip editing, TL-5 crossfades, TL-6 sample-accurate zoom and cuts, RC-3 resampling | S | none | Each marked Built, Todo or Not needed, with a note |

## Epic 9. Open-source voice (parked until Epics 1 to 6 are smooth)

Order and detail in plan section 5A.

| ID | Item | Size | Depends on | Acceptance |
|---|---|---|---|---|
| VX-1 | Spikes: Kokoro in the browser (load time, memory, speed) and the Qwen3-TTS helper on a GPU PC | M | Epics 1 to 6 | Numbers recorded |
| VX-2 | Provider interface, refactor `src/voice/voiceJob.ts` | S to M | VX-1 | Gemini works through the interface unchanged |
| VX-3 | In-browser engine in a Worker (Kokoro `q8`), install and remove flow, device tiers | M | VX-2, BR-2 | A voiceover generated fully on a mid-range device |
| VX-4 | Basic delivery controls: speed, pitch, pauses, emphasis, takes | M | VX-3 | Listening test shows audible difference |
| VX-5 | Local helper MVP (one engine), director notes for GPU users | L | VX-3 | Natural-language notes change the output in the listening test |
| VX-6 | Cloning with rights confirmation; second helper engine | M | VX-5 | Consent flow shown every time |
| VX-7 | Licence check for the phonemizer (espeak-ng) and model hosts before shipping | S | VX-1 | Written conclusion in `docs/` |

---

## Standing checks (every release)

- Free-tier review: current limits, usage so far, provider terms changes.
- No billing account on any provider.
- Secrets: none in the repo or the browser bundle; user keys stay in the browser.
- The browser matrix and the supported-length table match the latest measurements.
- Backlog statuses match reality (Built versus Verified).
