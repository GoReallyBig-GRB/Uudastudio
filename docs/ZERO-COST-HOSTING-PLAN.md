# Zero-cost hosting plan (hardened)

Status: plan for review. Nothing in this document has been built or measured. Every free-tier limit below is from memory and **must be re-checked on the provider's current pricing page before we rely on it** (marked ⚠ verify).

Replaces the "proxy everything to Cloud Run" assumption in `docs/cloudflare-deployment.md`.

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
| Sign-in | Firebase Auth on the **Spark** (no-card) plan | Spark has no billing account at all | Spark cannot use anything that needs Blaze; Google sign-in only ⚠ |
| Data (users, projects, tickets, templates) | Firestore on Spark, via its REST API from Workers | Spark quotas are hard limits: when exceeded, requests fail, nothing is billed ⚠ | Daily read/write quota is small; see budgets below |
| API | Worker handlers (section 4) | Free plan has a hard daily request cap and small per-request CPU ⚠ | Light routes only; no FFmpeg, no filesystem |
| Email (admin codes, ticket replies) | An HTTP email API with a no-card free tier (Brevo or Resend) ⚠ | Replaces Gmail SMTP, which Workers cannot speak | Check daily send limit and sender-domain rules |
| Audio assets, projects | The user's browser (IndexedDB) and `.uuda` files | Already how the app works | Browser quota, see section 5 |

**Why a hard cap matters.** On Cloudflare's free plan and Firebase Spark, going over the limit makes requests fail until the quota resets. You never get a bill. That failure mode is the peace of mind the owner wants, and it is the reason to prefer these two over any metered service.

**Not allowed to creep in:** a billing account on any provider, a "pay as you go" upgrade, Cloud Run, Cloud Functions (Blaze only), Cloud Storage for user audio, any paid DNS or email add-on.

## 4. Route inventory and decision

Counted from `server/*.ts` at `main`.

| Area | Routes (examples) | Needs today | Decision |
|---|---|---|---|
| Audio jobs | `/api/audio/*`, `/api/export/mp3` | native FFmpeg, temp files | **Delete or keep disabled.** Not called by the client; browser does this. |
| Health | `/api/health` | nothing | Worker handler. |
| Templates | `/api/templates` | store + `templateService.ts` (framework-independent) | Worker handler reusing `templateService.ts`. First to move. |
| Voice | `/api/voice/voices`, `/preview`, `/generate`, `/diagnose` | Gemini API via `fetch`; per-user key header | Worker handler. The user's key stays in a request header and is never stored. Waiting on Google is I/O, not CPU, so it suits the free CPU budget. ⚠ check a long TTS call against the Worker wall-clock limit |
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
| P-6 | **Streaming playback** of long sources (decode in windows) instead of holding the full `AudioBuffer` | Removes the 1.38 GB ceiling entirely; the real fix for hour-long files | Largest; do only if the envelope from P-1 to P-4 is not enough |

Order: P-1, then P-2, then P-4, then P-3, then P-5. Decide on P-6 from measurements, not from guesswork.

### 5.4 How we prove it (CI gates)

- Add an automated browser benchmark (Playwright, run in GitHub Actions) that imports generated reference audio at 10, 60 and 90 minutes, then records: time to first visible waveform, longest main-thread task, peak memory where the browser exposes it, zoom/scroll response time, and export duration. This is the same measurement list `VALIDATION_MATRIX.md` already requires, automated.
- **Thresholds are set from the first baseline, not guessed.** `VALIDATION_MATRIX.md` and the baseline doc deliberately refuse to invent numbers; this plan keeps that rule. After the baseline run, each metric gets a budget with headroom and the job fails if it is exceeded.
- Chromium is the only browser the CI job can drive well. Safari and Firefox need manual spot checks on a real device. State this limit openly rather than claim coverage.
- Phones and low-memory devices get a lower envelope than desktops. The P-1 check must use the device's memory, not the same number everywhere.

### 5.5 What the user sees

The supported envelope is shown in the app (for example: "Tested up to X minutes on this device class"). Over the limit, the user gets a clear message and a choice (downmix, split, or cancel), never a frozen tab.

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
| 4 | Port light routes to Workers (health, templates, voice, Freesound) | Each ported route has tests and a quota budget |
| 5 | Auth and Firestore access from Workers; email over HTTP | Sign-in, projects and tickets work with no Node server |
| 6 | Turn off the old API host | No remaining dependency on a billed service |
| 7 | P-3, P-5, then P-6 if needed | Larger envelope, only if measurements justify it |

Phases 2 and 3 can run in parallel with 4 to 6, because audio performance does not depend on hosting.

## 9. Open questions for the owner

1. Which devices and browsers must work? (This sets the envelope: a desktop-only podcast editor is a much easier target than a phone-friendly one.)
2. What is the longest file a typical user imports (minutes, mono or stereo)? Hour-long episodes drive P-6; 20-minute segments do not.
3. Is the Gemini voice feature required on day one? It is the route most exposed to a free-tier wall-clock limit.
4. Is it acceptable that account data (projects, tickets) lives on Firestore Spark while Google Auth stays, or should accounts be removed from the first release so there is no server data at all?
5. Is sign-in required for the first release, or can the app run signed-out with local projects only? A signed-out release would remove the entire Auth/Firestore port from the critical path.
