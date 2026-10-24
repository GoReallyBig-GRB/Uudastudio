# Zero-cost hosting plan (hardened)

Status: plan for review. Nothing in this document has been built or measured. Every free-tier limit below is from memory and **must be re-checked on the provider's current pricing page before we rely on it** (marked ⚠ verify).

Replaces the "proxy everything to Cloud Run" assumption in `docs/cloudflare-deployment.md`.

## 0. Owner decisions (2026-10-24)

**Sequencing (2026-10-24):** open-source voice (section 5A) is **parked** until the current app is running smoothly in AI Studio: guest invite, app-wide testing and UI optimisation come first. This plan stays as the reference for when voice work resumes.

| Question | Answer | Consequence |
|---|---|---|
| Devices and browsers | Mid-range devices and up. All Chromium browsers, plus Safari and Firefox. The app should **recommend** best browsers and device specs, while still letting weaker setups try | Capability tiers (section 5.6), not a hard block |
| Longest file | **3 to 4 hours** | See below: this makes streaming (P-6) mandatory |
| Tiered director notes (basic controls for all, natural-language direction only for GPU users running the helper) | **Accepted.** Cloning for accents is welcome and may be a selling point | Sections 5A.6 and 5A.7 |
| Gemini voice | **Revised 2026-10-24:** Gemini TTS is not free in production and most users cannot pay. Voice generation moves to open-source engines that run on the user's own device, delivered as optional downloadable add-ons | New section 5A. Voice needs **no server and no sign-in**. Gemini stays only as an optional bring-your-own-key engine |
| First release signed out? | Yes, local projects only. Voice no longer needs sign-in (section 5A) | **No Firebase, Firestore or auth port in the first release.** Static hosting plus one small Freesound proxy |

**What 3 to 4 hour files do to the plan.** Four hours of 48 kHz stereo float32 is about **5.5 GB** decoded; mono at 44.1 kHz is still about **2.5 GB**. No browser tab on a mid-range device can hold that as one decoded buffer, and the Web Audio `decodeAudioData` call decodes the whole file at once. So P-1 to P-4 alone cannot reach this target. **P-6 (streamed decoding and playback) is now required, not optional**, and it moves to the front of the performance work. The design shifts from "hold the audio in memory" to "hold peaks and a small window in memory, read the rest from disk on demand":

- Keep the imported file on disk (a `File` or origin-private file handle) and read byte ranges with `slice()`, never the whole file.
- Decode in windows (for example 30 to 60 seconds) with WebCodecs `AudioDecoder` where available, with a chunked WAV reader for WAV files. Support in Safari and Firefox for audio decoding is uneven, so each browser gets its own tier ⚠ verify.
- Precompute multi-resolution waveform peaks once, in a Worker, store them (IndexedDB), and draw only the visible region.
- Edits stay non-destructive: a clip is a reference to a time range of the source, so splitting and moving never copies audio.
- Playback schedules the current window plus a look-ahead buffer; seeking decodes the target window.
- Export streams: render in chunks and write each chunk out (File System Access write stream where available, otherwise assembled Blob parts), so peak memory is the chunk size, not the project length. A 4-hour WAV is still about 2.8 GB on disk; browsers without a streaming file write may not be able to produce it, which the tiers must say plainly.
- Effects that need the whole clip (loudness, denoise profile learning) must run in a streaming pass.

This is the largest single piece of work in the plan. Until it is built and measured, the honest published limit is whatever P-1 to P-4 can carry, not 4 hours.

## 1. Goal and hard constraints

1. **No card, no bill, ever.** The app is pre-traction and has no revenue; the owner wants to run it without any billing account attached.
2. **No Google Cloud billing.** Cloud Run and anything else that requires the Blaze plan or a billing account is out, even "within the free tier", because a billing account has no hard spending cap.
3. **The audio experience must work, not just be hosted.** Large audio files have already made the app struggle. Hosting must not make that worse, and the performance work must be measured, not assumed.

## 2. Findings that change the plan

These come from reading the repo at `main` (ac43c0d).

- **The FFmpeg routes are dead weight.** `/api/audio/*` and `/api/export/mp3` run native FFmpeg, but they are mounted only when `ENABLE_AUDIO_JOBS=true`, the Cloud Run image does not ship FFmpeg, and the client never calls them. The app already does denoise (`src/audio/dsp/denoiser.ts`, `DenoiserPlugin`), WAV export (`exportAudioBufferToWavAsync`) and MP3 export (`@breezystack/lamejs`) in the browser. **Nothing needs to "move to the browser": it is already there.** The server routes can be deleted or left disabled.
- **Hosting does not change audio performance.** Decoding, playback, waveform drawing, effects, undo and export all run in the user's browser. The server only handles sign-in, small JSON (projects, templates, tickets, usage), Freesound lookups and text-to-speech calls. Moving from Cloud Run to Cloudflare neither helps nor hurts how a 60-minute file behaves. That problem is real, but it is a separate workstream (section 5).
- **A performance framework already exists** in `docs/correction-strategy/` (`VALIDATION_MATRIX.md`, gates V-01 to V-12) and `docs/performance/long-timeline-baseline.md`. Its targets are all still "Open": no runtime measurements have been collected. This plan builds on it rather than replacing it.

## 3. Target architecture (no card)

| Layer | Choice | Why it costs nothing | Risk / ⚠ verify |
|---|---|---|---|
| Front end hosting | Cloudflare Workers static assets (already in `wrangler.jsonc`) | Free plan; static asset requests are not metered in the same way as Worker CPU ⚠ | Confirm the Workers Free plan needs no card to deploy |
| URL | `uudastudio.goreallybig.com` if the zone is on Cloudflare (DNS is free), otherwise the free `*.workers.dev` name | No extra cost beyond the domain the owner already holds | `workers_dev` is `false` today; flip it to test without DNS |
| Sign-in (later, not in the first release) | Firebase Auth on the **Spark** (no-card) plan | Spark has no billing account at all | Spark cannot use anything that needs Blaze; Google sign-in only ⚠ |
| Data (users, projects, tickets, templates) | Firestore on Spark, via its REST API from Workers | Spark quotas are hard limits: when exceeded, requests fail, nothing is billed ⚠ | Daily read/write quota is small; see budgets below |
| API | Worker handlers (section 4) | Free plan has a hard daily request cap and small per-request CPU ⚠ | Light routes only; no FFmpeg, no filesystem |
| Email (admin codes, ticket replies) | An HTTP email API with a no-card free tier (Brevo or Resend) ⚠ | Replaces Gmail SMTP, which Workers cannot speak | Check daily send limit and sender-domain rules |
| Audio assets, projects | The user's browser (IndexedDB) and `.uuda` files | Already how the app works | Browser quota, see section 5 |

**Why a hard cap matters.** On Cloudflare's free plan and Firebase Spark, going over the limit makes requests fail until the quota resets. You never get a bill. That failure mode is the peace of mind the owner wants, and it is the reason to prefer these two over any metered service.

**Not allowed to creep in:** a billing account on any provider, a "pay as you go" upgrade, Cloud Run, Cloud Functions (Blaze only), Cloud Storage for user audio, any paid DNS or email add-on.

## 4. Route inventory and decision

### 4.1 Sign-in scope for the first release

The first release is **signed out, local projects only**: projects, audio, templates and voiceovers live in the browser and in `.uuda` files. Because voice generation now runs on the user's device (section 5A), **nothing in the first release needs a sign-in**, so the Auth, Firestore, projects, tickets and admin routes all leave the critical path and stay on the roadmap. The only server-side piece left is a small Freesound proxy (its API credentials must not ship in the browser).

| Area | Routes (examples) | Needs today | Decision |
|---|---|---|---|
| Audio jobs | `/api/audio/*`, `/api/export/mp3` | native FFmpeg, temp files | **Delete or keep disabled.** Not called by the client; browser does this. |
| Health | `/api/health` | nothing | Worker handler. |
| Templates | `/api/templates` | store + `templateService.ts` (framework-independent) | Worker handler reusing `templateService.ts`. First to move. |
| Voice | `/api/voice/voices`, `/preview`, `/generate`, `/diagnose` | Gemini API, which is paid | **Retire from the server.** Replaced by on-device engines (section 5A). Optional bring-your-own-key Gemini can call Google straight from the browser. |
| Freesound | `/api/freesound/*` | `fetch`, server API key | Worker handler. Large downloads should be redirected, not proxied. |
| Auth | `/api/auth/*`, `requireAuth` | `firebase-admin` `verifyIdToken`, `crypto`, own session tokens | **Rework.** `firebase-admin` does not run on Workers. Verify Firebase ID tokens with Web Crypto against Google's public keys, then drop the custom `uuda_sess_` tokens if possible. Highest-risk part of the move. |
| Projects, tickets, usage, admin | `/api/projects*`, `/api/tickets*`, `/api/usage/my`, `/api/admin/*` | Firestore through `firebase-admin`, `nodemailer` | **Rework.** Firestore REST with a service-account JWT signed in the Worker, held as a Worker secret. Email via HTTP API. |
| Dev only | `/api/auth/dev-*` | local bypass | Stay Node-only; never deployed. |

Only the **Auth** and **Projects/tickets/admin** rows are real engineering. Everything else is a straightforward port.

**Pre-existing code to keep Express-independent:** `templateService.ts`, `voiceService.ts`, `authSecurity.ts`, and `server/store.ts` (the `DataStore` interface) are the seams. New Worker handlers should call these, not copy them.

### Free-tier budget (to fill in from the pricing pages ⚠)

Before moving a route, write down: requests per user per session, Worker CPU per request, Firestore reads/writes per request, and the provider's daily cap. Reject any design that spends the daily Firestore quota on one active user. Example of the shape of the check (numbers to be filled in, not assumed): "opening the dashboard = N reads; N × expected daily users ≤ cap with 50% headroom."

## 5. Browser performance: what can and cannot be guaranteed

**Honest statement.** Nobody can guarantee optimal performance for every file on every browser. Anyone who says so is selling something. What we can do is:

1. **Define a supported envelope** (duration, channels, sample rate, track and clip counts) per device class.
2. **Enforce it** so the app steers the user instead of freezing: warn, downgrade, or refuse before it runs out of memory.
3. **Measure it in CI** on every change, so a regression fails the build rather than reaching a user.

### 5.1 The actual problem

Decoded audio is held as 32-bit float. From `docs/performance/long-timeline-baseline.md`: 60 minutes of 48 kHz stereo is about **1.38 GB** of samples, plus a mono copy for waveforms of about 690 MB, before the encoded source, canvases, other tracks and temporary copies. A mid-range laptop tab, and most phones, will not survive that. This is a memory problem, not a CPU or hosting problem.

### 5.2 What already helps (on `main`)

- Responsive WAV and MP3 export that yields to the browser between blocks (`exportAudioBufferToWavAsync`, `exportAudioBufferToMp3`).
- Project open shows the project before background persistence completes.
- Autosave is serialised and skips unsaved asset references.
- Loudness analysis is bounded-memory (`loudnessMemory.test.ts`) and reports progress.

### 5.3 What does not exist yet (the work)

| # | Change | Effect | Cost to build |
|---|---|---|---|
| P-1 | **Pre-flight size check** on import: estimate decoded bytes from duration, channels and sample rate; compare with `navigator.deviceMemory` and a configurable ceiling; warn or refuse with plain guidance before decoding | Prevents the crash instead of causing it | Small |
| P-2 | **Bounded waveform cache** (LRU with a byte cap) and viewport-limited canvas width; stop allocating one canvas as wide as the whole timeline | Removes the second-biggest memory consumer; the baseline doc already lists this as step 1-2 | Medium |
| P-3 | **Decode-and-downmix options** for long speech: import a long file at lower sample rate and/or mono if the user opts in (speech does not need 48 kHz stereo) | Halves or quarters memory for the common podcast case | Medium |
| P-4 | **Move heavy loops to Web Workers**: waveform peak generation, MP3 encoding, loudness analysis | Keeps the UI thread free so the app stays responsive | Medium |
| P-5 | **Chunked/streamed export** so peak memory during export is bounded by chunk size, not by project length | Makes long exports possible on small machines | Larger |
| P-6 | **Streaming import, playback and export** of long sources (decode in windows, peaks precomputed, non-destructive clip references) instead of holding the full `AudioBuffer` | Removes the memory ceiling entirely; the only route to 3 to 4 hour files | Largest. **Required** (owner target is 3 to 4 hours) |

Order: P-1 (safety net first), then P-6 and P-4 together (they share the peaks and worker design), then P-2, P-5 and P-3. P-1 to P-4 remain useful as the fallback for browsers where streaming decode is unavailable.

### 5.4 How we prove it (CI gates)

- Add an automated browser benchmark (Playwright, run in GitHub Actions) that imports generated reference audio at 10, 60 and 90 minutes, then records: time to first visible waveform, longest main-thread task, peak memory where the browser exposes it, zoom/scroll response time, and export duration. This is the same measurement list `VALIDATION_MATRIX.md` already requires, automated.
- **Thresholds are set from the first baseline, not guessed.** `VALIDATION_MATRIX.md` and the baseline doc deliberately refuse to invent numbers; this plan keeps that rule. After the baseline run, each metric gets a budget with headroom and the job fails if it is exceeded.
- Chromium is the only browser the CI job can drive well. Safari and Firefox need manual spot checks on a real device. State this limit openly rather than claim coverage.
- Phones and low-memory devices get a lower envelope than desktops. The P-1 check must use the device's memory, not the same number everywhere.

### 5.6 Capability tiers (recommend, don't block)

On first load the app checks the browser and device (`navigator.deviceMemory`, hardware threads, WebCodecs audio support, File System Access write streams, storage quota) and shows a tier:

| Tier | Meaning | Typical match | What the app does |
|---|---|---|---|
| Recommended | Streaming decode and streamed export available, enough memory | Desktop Chromium (Chrome, Edge, Brave, Opera) with 8 GB or more | Full envelope, including 3 to 4 hour files |
| Supported | Works, with a lower or slower envelope | Safari, Firefox, mid-range laptops, tablets | Lower published file length; falls back to windowed or downsampled paths; clear note on what is limited |
| Limited | Will run, but long files are unlikely to succeed | Low-memory phones, older browsers | Pre-flight (P-1) warns before every large import; offers downmix, split, or cancel |

A "Best experience" note lists recommended browsers and minimum specs, but nothing blocks a user from trying. The thresholds are set from the benchmark baseline (section 5.4), not guessed here. Browser support facts above are marked ⚠ verify and must be confirmed per browser before the tier table is published.

### 5.5 What the user sees

The supported envelope is shown in the app (for example: "Tested up to X minutes on this device class"). Over the limit, the user gets a clear message and a choice (downmix, split, or cancel), never a frozen tab.

## 5A. Voice generation without paid services

**Why.** Gemini TTS is free inside AI Studio but is a paid API in production, and most Uuda users cannot pay for it. Free voiceovers are core to Uuda's value, so the default engine must run at no cost to the owner or the user.

**Principle.** The voice engine runs **on the user's own device**. The owner pays for no inference, the server holds no voice key, and no sign-in is needed. Engines are optional **add-ons** the user chooses to download, shown with their size and a device recommendation.

### 5A.1 Candidate engines (facts from the sources listed below; ⚠ verify before building)

| Engine | Licence | Size / memory (vendor benchmark, Node, not a browser) | Fits as | Notes |
|---|---|---|---|---|
| **Kokoro-82M** | Apache-2.0 | ~341 MB model, ~2.0 GB peak RAM, slower than real time on one CPU core in the benchmark | In-browser add-on via `kokoro-js` (Transformers.js): WebGPU or WASM, `fp32`/`fp16`/`q8`/`q4` | Good quality for its size; 28 English voices listed (American and British); no instruction following like Gemini's director notes |
| **Kitten TTS Nano** | Apache-2.0 | ~42 MB, ~320 MB RAM, no streaming | Low-memory in-browser add-on | Smallest option; the lowest-spec device tier |
| **Supertonic TTS 2** | MIT | ~262 MB, ~450 MB RAM, ~0.5x core-hour ratio | In-browser add-on candidate; browser support is claimed | Faster than Kokoro on CPU in the benchmark |
| **Piper** | MIT (original) / GPLv3 (current fork) | ~61 MB model, ~2.6 GB peak RAM in the benchmark | Local helper add-on, not bundled | 100+ voices across 30+ languages; the GPL fork has obligations, so ship it only as a separate download with its own licence |
| **Chatterbox-Turbo** | MIT | ~3 GB model, ~7.5 GB RAM, heavy | Optional **desktop helper** for capable PCs, voice cloning | Too heavy for the browser; strong-PC add-on only |
| **Qwen3-TTS** (0.6B / 1.7B) | Apache-2.0 | Not stated; GPU (CUDA) expected, slow without one | Local-helper add-on for PCs with a GPU | **Plain-language direction of timbre, emotion and prosody** ("tense, whispering, urgent"); voice design from a text description; 3-second voice cloning; 10 languages. Accent by instruction is not documented, only preset dialect voices |
| **Chatterbox (Nano / Turbo / Multilingual)** | MIT | Nano ~110M (CPU, about 3x slower than real time on 8 cores per one review); Turbo ~350M and Multilingual ~500M want a GPU | Helper add-on; Nano may reach the browser later | Emotion "exaggeration" control, paralinguistic tags (laugh, sigh), cloning from a short reference clip, which is the practical route to a specific accent |
| **Supertonic 3** | OpenRAIL-M (use restrictions apply; one benchmark listed Supertonic TTS 2 as MIT, so check the exact version) | ~99M, designed for CPU | In-browser candidate | About ten inline expression tags (laugh, sigh and similar); 31 languages listed |
| **Orpheus / Dia** | Apache-2.0 (Orpheus also carries Meta's Llama terms) | GPU-class | Not recommended for v1 | Emotion tags / nonverbal cues, English-centred |
| **IndexTTS 2.5, Fish Audio S2 Pro** | Not cleared for commercial use | GPU-class | **Do not use** | Strong emotion control, but the licences do not allow Uuda's use |
| **Coqui XTTS v2** | **CPML: non-commercial only** (covers the model *and its outputs*) | Not stated; GPU strongly recommended | **Do not use** | See below |

**XTTS v2 is not suitable.** Its licence allows only non-commercial use of the model and its outputs, Coqui shut down in December 2023, and there is no confirmed route to a commercial licence. A user who uploads a voiceover made with it to a monetised podcast or video would be outside the licence, and Uuda would be distributing it. For a product whose users are creators, that is a legal risk the owner should not take. Chatterbox (MIT) covers the voice-cloning need without that problem.

### 5A.2 How the add-ons plug in

The app has one voice seam today: `src/voice/voiceJob.ts` posts to `/api/voice/generate` and expects WAV audio back. The change is a **provider interface**:

```
VoiceProvider {
  id, name, license, downloadSizeMb, minimumDevice
  status(): 'not-installed' | 'downloading' | 'ready' | 'loading' | 'error'
  install(onProgress), remove()
  voices(): Voice[]
  generate({ script, voiceId, speed, signal, onChunk }): Promise<AudioBuffer>
}
```

- **In-browser providers** (Kokoro, Kitten, Supertonic) run in a **dedicated Web Worker**, never on the main thread, so the editor stays responsive.
- **Local-helper providers** (Chatterbox, Piper) are separate programs the user installs; the page talks to them on `127.0.0.1`. Browser rules for a secure page calling localhost differ by browser (Safari restricts it; recent Chromium versions add a permission prompt) ⚠ verify, so helpers are an **extra** path, not the default.
- **Gemini** becomes an optional provider using the user's own key, called from the browser. Nothing is stored on a server. It is clearly labelled as paid by Google.
- Model files download **straight from their public host** (for example Hugging Face) to the user's browser and are cached in browser storage (Cache API or origin-private storage). Our free Worker never proxies them, so they cost no bandwidth quota. The page's content-security policy must allow that host. ⚠ verify host terms and CORS.
- The user sees the download size and a device recommendation **before** installing, can remove the model, and storage use is visible.
- Long scripts are split by sentence, generated chunk by chunk, and written out as they finish, so memory stays bounded and progress is real.

### 5A.3 The memory problem (the real risk)

The voice model competes for memory with the editor, and the editor is already memory-constrained (section 5). Rules to protect it:

1. **Load on demand, unload when idle.** The model is loaded when the user generates and released after a short idle period or on a memory warning.
2. **One heavy thing at a time on small devices.** The P-1 pre-flight (section 5.3) accounts for the voice model: on a low-memory device it can say "close the long project, or use the small voice."
3. **Tier the engine to the device (section 5.6):**
   - Low memory, no WebGPU: Kitten TTS Nano (or Supertonic) on WASM.
   - Mid-range: Kokoro quantised (`q8` or `q4`) on WASM.
   - Capable with WebGPU: Kokoro `fp32` on WebGPU.
   - Strong desktop with a GPU: optional helper (Chatterbox) for cloning.
4. **Measure, don't trust the table.** The numbers above are from one vendor's Node benchmark on a desktop CPU. In-browser speed and memory must come from our own benchmark on mid-range devices (section 5.4). A rough check: if Kokoro `q8` on a mid-range laptop takes longer than a set multiple of the audio length per sentence, that tier is demoted or the engine is offered only as "slow but free".

### 5A.4 What changes for users (be upfront in the app)

- **Director notes need their own design (section 5A.6).** On a typical CPU or browser the open engines cannot follow free-text direction the way Gemini does.
- **Language coverage is narrower.** The listed Kokoro voices are English; other languages vary by engine ⚠ verify. Languages the owner's users need (for example Nigerian languages) are probably **not** covered by any of these engines. This needs a decision (see section 9).
- **The first generation includes a model download.** Hundreds of MB the first time, then cached.
- The server-side Gemini checks in `server/voiceService.ts` (transcribe and word-error-rate verification, banned-phrase checks) depend on paid calls and don't carry over. Local engines need cheaper checks (empty or clipped audio) instead.

### 5A.6 Director notes: what is possible for free

Director notes (emotion, tension, tone, accent) are central to voiceover, and a plain reader is not enough. Honest position: **no permissively licensed model today gives Gemini-like free-text direction on an ordinary CPU or inside a browser.** The ones that follow plain-language direction (Qwen3-TTS) want a CUDA GPU. So direction is delivered in tiers, and the app must say which tier a user is on:

| Tier | Engines | What direction the user gets | Who it reaches |
|---|---|---|---|
| **1. Performance controls (everyone, in browser)** | Kokoro, Supertonic, Kitten | Voice choice, speed, pitch shift, per-sentence pauses and emphasis markup, expression tags where the engine has them (laugh, sigh), and **takes**: generate several variations and keep the best. Uuda's own editing tools (timing, EQ, effects, ducking) do the rest | Every device. Real but limited: this shapes delivery, it does not understand "say it like a frightened whisper" |
| **2. Natural-language direction (GPU desktop helper)** | Qwen3-TTS (Apache-2.0) | Free-text director notes for emotion, tone and pacing, plus voice design from a description | Users with an NVIDIA-class GPU who install the helper |
| **3. Emotion slider, tags and cloning (helper)** | Chatterbox (MIT) | Emotion exaggeration, laugh/sigh tags, and **accent through cloning**: the user supplies a short reference clip of the voice or accent they want | Capable PCs; Nano may run on CPU slowly |
| **4. Gemini (optional, paid by the user)** | Gemini TTS through the user's own key | The current director-notes experience | Only users willing to pay Google; clearly labelled |

Rules for this:
- **Cloning and accents.** Cloning needs a reference clip. The app must ask the user to confirm they have the right to use that voice, and must not ship cloned or celebrity voices.
- **No false promise.** The Voiceover panel shows the director-notes field only for engines that support it. For tier 1 it shows the controls that actually do something.
- **Listening test before we claim anything.** Before publishing a tier, run a fixed test script with six directions (for example calm, urgent, tense whisper, joyful, sad, with a named accent) on each engine and record whether listeners can hear the difference. A tier that fails is described as "reading with adjustable delivery," not as acting.
- **Possible zero-cost GPU route (needs investigation, not a promise).** Users without a GPU might run the helper in a free notebook service (for example Google Colab or Kaggle). Their terms limit running public services and GPU time is not guaranteed ⚠ verify before offering it; do not build on it until the terms are confirmed.

### 5A.7 Build complexity and memory load

**Memory arithmetic (weights only = parameters × bytes per parameter; real use adds runtime overhead and working memory, so treat these as lower bounds, to be replaced by measurements).**

| Engine and precision | Weights in memory | Where it lives |
|---|---|---|
| Kokoro-82M `fp32` | about 330 MB | Browser tab (WASM) or GPU memory (WebGPU) |
| Kokoro-82M `fp16` | about 165 MB | same |
| Kokoro-82M `q8` | about 82 MB | same |
| Kokoro-82M `q4` | about 41 MB | same (quality loss to be judged by ear) |
| Kitten TTS Nano | about 42 MB | Browser tab |
| Supertonic (~99M) | about 100 MB to 260 MB | Browser tab |
| Qwen3-TTS 0.6B, bf16 | about 1.2 GB | **Helper process, GPU memory** |
| Qwen3-TTS 1.7B, bf16 | about 3.4 GB (about 1.7 GB if 8-bit) | **Helper process, GPU memory** |
| Chatterbox Turbo (~350M) | about 0.7 GB | **Helper process** |

On top of the weights: the runtime (WASM or ONNX runtime, a few tens of MB), the phonemizer, activation memory that grows with the length of text per call, and a **load-time peak of roughly twice the weights** while the file is read and copied into the runtime. A vendor benchmark measured about 2 GB peak for Kokoro on a desktop in Node, with its default settings; we expect far less with `q8` and short chunks but must measure it in a browser.

The generated audio is small: Kokoro output is 24 kHz mono float32, about 5.8 MB per minute, so a 10-minute voiceover is about 58 MB. That is minor next to the editor's own buffers.

**What the tab really pays.** With a quantised in-browser engine: roughly **100 to 400 MB on top of the editor**, only while the model is loaded. With the **helper**, the model sits in a separate process and GPU, so the tab pays almost nothing beyond the returned audio. The helper tiers are the best memory story; the in-browser tier is the one that needs care.

**How to reduce it (in order of impact):**
1. **Quantise.** Ship `q8` as the default in-browser build and offer `q4` for the smallest devices if listening tests allow. This is the biggest single saving (about 4x versus `fp32`).
2. **Run in a Web Worker and terminate it when done.** WebAssembly memory cannot shrink inside a running worker, so "unloading" means ending the worker, which returns the whole heap to the browser. Load on demand, terminate after a short idle period.
3. **Short chunks.** Split scripts by sentence and cap characters per call, so activation memory stays flat however long the script is. Write each finished chunk out immediately.
4. **Stream the model load.** Read weights from the browser's cache in pieces rather than holding the file and the runtime copy at once, to flatten the load-time peak.
5. **Don't compete with a long project.** The P-1 pre-flight blocks or downgrades the voice model on low-memory devices when a large project is open, and offers `q4`/Kitten instead.
6. **Use the editor's streaming design.** Once long audio streams from disk (section 5, P-6), the editor's footprint falls to a few hundred MB, which leaves room for a voice model. The two pieces of work help each other.
7. **WebGPU only where it helps.** On a discrete GPU, weights move off system RAM. On integrated graphics the memory is shared, so there is no saving; measure before recommending it.
8. **Keep the heavy models out of the tab.** Anything over about 500 MB belongs in the helper.

**Build complexity** (S = days of focused work, M = about a week or two, L = several weeks, with testing and support; relative sizes, not promises):

| Piece | Size | Notes |
|---|---|---|
| Provider interface; refactor `voiceJob.ts` and the Voiceover panel | S to M | One seam today; well contained |
| In-browser engine in a Worker: Kokoro `q8`, progress, cancel, sentence chunking | M | Library exists (`kokoro-js`); the work is the worker protocol, cancellation and error handling |
| Add-on install flow: download with progress, cache, storage meter, remove, consent, content-security policy | M | Needed for every engine |
| Device detection, tiers and pre-flight memory check | M | Shared with the performance work (section 5) |
| Tier 1 controls: speed, pitch, pauses and emphasis markup, takes UI | M | Mostly app work, little model risk |
| Cloning consent flow and reference-clip handling | S to M | Mostly UX and rules |
| **Local helper: packaging, GPU detection, localhost protocol, Qwen3-TTS and Chatterbox wrappers, updates** | **L, the largest piece** | Cross-platform installers, CUDA setup and support burden are the hard part, not the model code. Start with an advanced-user install and improve later |
| Listening-test harness and the six-direction test | S | Needs real listeners |
| Tests | M | Engines cannot run in unit tests; use mocks, and run browser benchmarks in CI on CPU only. GPU engines are tested by hand on a real machine |

**Suggested slices:** A) provider seam plus Kokoro `q8` in a Worker plus install flow, which delivers free voices to everyone; B) tier 1 controls and takes; C) helper MVP with one engine; D) cloning, then the second engine.

**Risks to resolve early:** in-browser speed on mid-range devices (the table above says nothing about it); Safari and Firefox WebGPU and Worker behaviour; the model host's terms and uptime; the phonemizer that `kokoro-js` uses ships an `espeak-ng` build, and espeak-ng is GPL-3.0, so its licence obligations on a web app need a proper check ⚠ verify before shipping; and helper support load.

### 5A.5 Consequence for the rest of the plan

Voice no longer needs a server, a key or sign-in. That removes the last reason for Firebase or Firestore in the first release. The deployment becomes **static hosting on Cloudflare plus one small Freesound proxy**, which is both the cheapest and the simplest version of this plan.

Sources checked: [kokoro-js on npm](https://www.npmjs.com/package/kokoro-js) (Apache-2.0, WASM/WebGPU, dtype options, 28 listed voices), [XTTS v2 review](https://www.promptquorum.com/power-local-llm/xtts-v2-review) (CPML non-commercial, Coqui shutdown, GPU recommended), [Picovoice on-device TTS benchmark](https://picovoice.ai/blog/on-device-tts/) (sizes, memory and licences in the table; the author sells a competing product and ran Node on one desktop CPU).

## 6. Stop conditions and fallbacks

If a gate fails, the answer is to **narrow the supported envelope**, not to ship and hope. Examples:

- If 60-minute projects cannot meet the budget after P-1 to P-4, ship with a published 30-minute limit and keep P-6 on the roadmap.
- If Firestore Spark quotas cannot carry the expected users, cut the data stored server-side (templates and projects stay local or exportable) before considering any paid plan.
- If Worker CPU limits block a route (token verification, large downloads), push that work to the client or to a redirect. Do not add a paid backend to rescue it.
- If the free tier of any provider changes so the plan no longer holds, we find out from the monitoring in section 7, not from a bill, because there is no bill.

## 7. Guardrails that keep it at zero

- No billing account on Google Cloud or Cloudflare. Write this in the repo README as a project rule.
- A `docs/` checklist reviewed each release: current free-tier limits, quota use so far, any provider terms changes.
- A simple health/quotas page for the admin (requests and Firestore operations used today) so a cap hit is visible and explained rather than mysterious.
- CI keeps `CLOUDFLARE_DEPLOY_ENABLED` opt-in until the zone, secrets and API handlers are ready.
- The user's Gemini key is never logged or stored; keep the existing rule.

## 8. Phases and exit criteria

| Phase | Work | Exit criterion |
|---|---|---|
| 0 | This plan agreed; free-tier limits verified from current pricing pages | Limits table filled in with sources |
| 1 | Static front end on Cloudflare (free), API temporarily wherever it runs now, then **delete the dead FFmpeg routes** | Site loads from Cloudflare; no change in audio behaviour |
| 2 | Benchmark harness in CI, baseline measured, budgets set (section 5.4) | `VALIDATION_MATRIX.md` performance register filled in with real numbers |
| 3 | P-1, P-2, P-4: pre-flight check, bounded caches, workers | Gates pass at the envelope we choose to publish |
| 4 | **Voice add-ons** (section 5A): provider interface, Kokoro in a Worker on WASM, device tiers, model download and cache, then a Freesound proxy Worker | A voiceover generated fully on-device on a mid-range test device, within the memory budget; no server voice call |
| 5 | (After first release) Auth and Firestore access from Workers; email over HTTP; cloud templates and projects | Sign-in, projects and tickets work with no Node server |
| 6 | Turn off the old API host | No remaining dependency on a billed service |
| 7 | P-3, P-5, then P-6 if needed | Larger envelope, only if measurements justify it |

Phases 2 and 3 can run in parallel with 4 to 6, because audio performance does not depend on hosting.

## 9. Open questions for the owner

**Answered, see section 0.** Remaining open items are 4 (explained below) and the voice-key design in section 4.1.

Original questions:

1. Which devices and browsers must work? (This sets the envelope: a desktop-only podcast editor is a much easier target than a phone-friendly one.)
2. What is the longest file a typical user imports (minutes, mono or stereo)? Hour-long episodes drive P-6; 20-minute segments do not.
3. **Answered:** voice moves to on-device open-source engines (section 5A). New questions: (a) which languages must voices cover? (b) is voice cloning needed, or are fixed voices enough? (c) given section 5A.6, is tiered direction acceptable: basic controls for everyone, full natural-language direction only for GPU users running the helper? (d) is cloning needed for accents?
4. (Reworded) Do you want projects, templates and support tickets saved on our servers for signed-in users in the first release, or kept only on the user's device? The signed-out first release implies device-only.
5. Is sign-in required for the first release, or can the app run signed-out with local projects only? A signed-out release would remove the entire Auth/Firestore port from the critical path.

## 10. Guest invite design (zero cost, decided 2026-10-24)

Owner decisions: build the **zero-cost design now**, not the PRD's Cloud Storage design (PRD GC-1/GC-2). Two guest types:

- **Offline guest (single record):** the guest opens a link, records, previews, then sends. Matches PRD GC-1.
- **Live room:** audio-first WebRTC room for podcast-style sessions, **up to 4 participants**, with true live streaming (broadcast to many listeners) as a **later** addition. Matches PRD GC-2.

Delivery of takes: **direct browser-to-browser by default**, an **optional producer-owned cloud storage** for when the producer is offline, and a **manual file fallback** (the guest downloads a WAV and sends it themselves) so a recording is never lost.

### 10.1 Shared pieces

| Piece | Design | Free-tier note |
|---|---|---|
| Invite link | `/join/<token>`, served by the existing single-page app. 128-bit random token; expiry (default 7 days), optional use limit, revocable, mode set by the producer (Offline or Live). Token is stored hashed wherever the server keeps it | Static hosting, no cost |
| Signalling (who connects to whom) | A small Cloudflare Worker with one **Durable Object per room** (WebSocket, message relay only). In AI Studio staging the same message protocol runs on the Express server so the transport can be swapped without changing the client | Durable Objects are available on the Workers Free plan (SQLite backend only), with 100,000 requests a day and a hard stop when exceeded. Signalling messages are tiny, but each room's connect and relay messages count against that daily cap, so keep chatter low ⚠ verify the current limits |
| NAT traversal | Public STUN for most connections. A relay (TURN) is needed when both sides sit behind strict or carrier-grade NAT, which is common on mobile networks | Cloudflare Realtime TURN lists a free allowance of 1,000 GB, but I could not confirm from its docs whether a payment method is needed to use it ⚠ verify. If TURN is not available at zero cost, the app falls back to the manual file path and says why |
| Capture | Raw PCM through an `AudioWorklet`, written as WAV (16 or 24-bit), not the browser's compressed recorder. Chunks are saved to origin-private storage as they arrive, so a closed tab or crash does not lose the take | No server |
| Sanity limits | Maximum duration and size per take, audio-only check, decode only (never execute), rate limits per link | |
| Resampling | Takes at other sample rates are resampled offline to the project rate before placement (PRD RC-3) | |
| Result on the timeline | A new track named "Guest: <name>" with the take, plus the invite's script and metadata | |

### 10.2 Offline guest (single record, preview, send)

1. Producer: "Invite guest voice" on a track, optional script and expiry; the app creates the link.
2. Guest opens the link, sees the session name and a script preview, tests the microphone with a level meter and picks the input device. Offline takes are usually **scripted**, so one tap on the preview opens a **full-screen scrollable script** and one tap returns to the recording screen, with elapsed and remaining time visible on both (backlog GM-11 to GM-16).
3. Guest records, **previews** the take, can re-record, then presses Send.
4. **Delivery, in this order:**
   - **A. Direct.** If the producer's Uuda tab is open, the take travels over a WebRTC data channel to the producer, in chunks, with progress and resume.
   - **B. Producer-owned storage (optional).** If the producer configured a bucket (10.4), the guest uploads straight to it with a time-limited upload URL carried in the invite.
   - **C. Manual file.** The guest downloads the WAV and sends it themselves, and the producer drops it on the timeline.
5. The guest sees a clear "sent" or "not sent yet, here is why" state. Nothing is ever shown as sent when it was not.

Without a server holding files, **A needs the producer online** and **B is what covers an offline producer**. That is why B exists.

### 10.3 Live room (up to 4 participants)

- **Topology:** a peer-to-peer mesh. Up to 4 people means each browser holds 3 audio connections. Opus voice at a normal bitrate is a few tens of kbit/s per stream, so CPU and bandwidth are small. No media server is needed at this size.
- **Double-ender recording:** each participant's browser records their own microphone locally at full quality (the call is only for talking). When the session ends, each take is delivered by the same A/B/C paths as the offline guest, so tracks stay separate and uncompressed.
- **Sync:** the producer's start command carries a shared timestamp; each take is saved with its local start time. On arrival the tracks are placed using those offsets, with an optional shared marker (a short beep) for fine alignment and the existing latency handling.
- **Protection against loss:** local capture is persisted in chunks while recording, and the guest page keeps the take until delivery is confirmed.
- **Quality advice shown in the room:** use headphones (echo), a wired or stable connection, close heavy tabs. The room shows each participant's connection state.
- **Later: true live streaming** (one-to-many broadcast) needs a media relay (an SFU). That is the first point where free tiers may not be enough. Keep the room protocol compatible with it, and decide the hosting for it when the feature is scoped.

### 10.4 Producer-owned cloud storage (option B)

The owner asked which storage services work, whether Google Drive is usable, and whether Cloudflare R2 is a good free pointer. Findings:

| Service | Fit | Notes |
|---|---|---|
| **S3-compatible bucket** (Cloudflare R2, Backblaze B2 and others) | **Best technical fit, supported first** | The producer pastes the bucket endpoint and an access key limited to that bucket. The producer's own browser signs **time-limited upload URLs** and puts them in the invite, so no Uuda server holds anything. The guest uploads directly. The producer sets the bucket's cross-origin rule once. Keys stay in the producer's browser (same rule as the Gemini key: never sent to us) |
| **Cloudflare R2** | Works as above, generous free tier: about 10 GB storage and no download fees | One source says Cloudflare **may require a payment method** to enable R2 even for the free tier ⚠ verify. If so, it is free to use but not "no card", and the app must say so before pointing anyone there |
| **Google Drive** | Possible, weaker fit | Drive uploads need the producer signed in with Google. A short-lived token in the producer's browser can start an upload session whose URL is handed to the guest, but token lifetime, browser cross-origin behaviour and Google's app-verification rules make it more fragile ⚠ verify. Free space is 15 GB shared with the producer's Gmail |
| **Dropbox** | Possible later | Offers one-time upload links, but the free tier is small (about 2 GB) and linking needs an OAuth flow ⚠ verify |

Decision: ship **S3-compatible** first; treat Drive and Dropbox as later connectors behind the same interface. Producers who need option B maintain their own storage and cost, as the owner stated.

### 10.5 Security rules (apply to every path)

- A guest can reach one thing only: send audio for that one link. No project data, no other guest's take.
- All received audio is untrusted: size and duration caps, decode in a worker, reject non-audio.
- Link tokens are random, expiring and revocable. Rate limits per link and per address.
- Producer storage keys never leave the producer's browser. Upload URLs expire quickly and are scoped to one object name.
- The guest page asks for the microphone and says plainly what is recorded and where it goes.
- Consent notice in live rooms that every participant is recorded locally.

### 10.6 Build order

1. **Link and guest page shell:** `/join/<token>`, mic test, record to local storage, preview, manual-file send (path C). Works with no network service at all.
2. **Signalling Worker plus Express staging twin;** direct delivery (path A) for offline guests.
3. **Producer-side inbox:** accept takes, resample, place on the timeline.
4. **Live room** (mesh, up to 4) with local recording and the same delivery paths.
5. **Producer-owned S3-compatible storage** (path B).
6. **TURN fallback** once its free terms are confirmed; live streaming later.

### 10.7 Open items before building

1. Confirm free terms for TURN and for R2 activation ⚠.
2. Confirm that AI Studio's staged app can open a WebSocket for the staging signalling twin.
3. Browser support: microphone capture and WebRTC work on all major browsers, but AudioWorklet and file-handle behaviour differ on Safari and Firefox, so the guest page needs a tested fallback and a clear "use Chrome or Edge" note.
