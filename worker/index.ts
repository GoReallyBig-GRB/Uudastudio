export { JobRoom } from "./jobs/jobRoom";
export { JobRegistry } from "./jobs/jobRegistry";
export { LiveRoom } from "./live/liveRoom";
import { handleRoomConnect } from "./live/roomEntry";
import { iceServersForEvent } from "./live/turn";
import { D1RelayLedger } from "./live/relayLedger";
import { stateOf } from "./live/rules";
import { isAuthProxyPath, proxyAuth } from "./authProxy";
import { withOrigin } from "./pageMeta";
import { handleAuth, type AuthEnv } from "./auth/handler";
import { D1UserStore } from "./auth/users";
import { makeLimiter } from "./auth/rateLimit";
import { fetchGoogleKeys, keyCache } from "./auth/verifyIdToken";
import { handleTemplates } from "./templates/handler";
import { handleLive } from "./live/handler";
import { D1LiveStore } from "./live/store";
import { D1TemplateStore, type D1Full } from "./templates/store";
import { handleFreesound } from "./freesound/handler";
import { D1TokenStore, makeSealer } from "./freesound/tokens";

export interface Env {
  ASSETS: Fetcher;
  /** One Durable Object per voice-talent job (script, message thread, audio) */
  JOB_ROOM: DurableObjectNamespace;
  /** One account-wide object that tracks audio bytes so uploads can be refused before Cloudflare's free 5 GB cap. Optional. */
  JOB_REGISTRY?: DurableObjectNamespace;
  /** One Durable Object per live event: who is in the room, call signalling, record/stop moments. No audio passes through it. */
  LIVE_ROOM?: DurableObjectNamespace;
  /** Cloudflare Realtime TURN key (id is a plain variable, TURN_API_TOKEN is a secret). Without them calls use STUN only. */
  TURN_KEY_ID?: string;
  TURN_API_TOKEN?: string;
  /** Optional settings (plain numbers as text): bytes allowed in total (default 4 GB), bytes and seconds per take */
  STORAGE_LIMIT_BYTES?: string;
  MAX_TAKE_BYTES?: string;
  MAX_TAKE_SECONDS?: string;
  /** Optional. If set, creating a job needs this code (typed once in the Jobs panel). */
  JOBS_CREATE_CODE?: string;
  /** Optional limits on creating jobs, per network address and in total, per UTC day (defaults 100 and 500) */
  JOBS_PER_ADDRESS_PER_DAY?: string;
  JOBS_PER_DAY?: string;
  /** Accounts (Cloudflare D1). With FIREBASE_PROJECT_ID and SESSION_SECRET, this Worker handles sign-in itself. */
  AUTH_DB?: D1Full;
  /** Freesound sound library. FREESOUND_CLIENT_SECRET is a secret (Freesound's "Client Secret" and "API key" are the same string; FREESOUND_API_KEY also works); FREESOUND_CLIENT_ID is a plain variable. */
  FREESOUND_API_KEY?: string;
  FREESOUND_CLIENT_ID?: string;
  FREESOUND_CLIENT_SECRET?: string;
  /** The Firebase project the browser signs in with (a public id, not a secret) */
  FIREBASE_PROJECT_ID?: string;
  /** Secret that signs session tokens. Set with `wrangler secret put SESSION_SECRET` (or the dashboard). Never in the repository. */
  SESSION_SECRET?: string;
  /** This email becomes the admin account */
  SUPER_ADMIN_EMAIL?: string;
  /**
   * Public origin of the existing Uuda Studio API service, e.g.
   * https://your-service-xxxxx-uc.a.run.app
   *
   * Set this as a Worker variable in Cloudflare. Do not include a trailing path.
   */
  API_ORIGIN?: string;
}

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

// Google's signing keys are kept for as long as Google allows, per isolate
const googleKeys = keyCache(fetchGoogleKeys);
// At most 10 sign-in attempts a minute per address, per Worker instance
const signInLimiter = makeLimiter(10, 60_000);

/** Sign-in is handled here only when its database, project id and secret are all set; otherwise /api/auth/* goes to API_ORIGIN as before */
const templateLimits = { list: makeLimiter(60, 60_000), write: makeLimiter(30, 60_000) };
const roomLimit = makeLimiter(30, 60_000);
const liveLimits = { producer: makeLimiter(60, 60_000), guest: makeLimiter(60, 60_000) };
const freesoundLimits = { search: makeLimiter(50, 60_000), sharedSearch: makeLimiter(15, 60_000), other: makeLimiter(30, 60_000) };

const authEnv = (env: Env): AuthEnv | null =>
  env.AUTH_DB && env.FIREBASE_PROJECT_ID && env.SESSION_SECRET
    ? { store: new D1UserStore(env.AUTH_DB), projectId: env.FIREBASE_PROJECT_ID, sessionSecret: env.SESSION_SECRET, superAdminEmail: env.SUPER_ADMIN_EMAIL, keys: googleKeys, now: Date.now, limiter: signInLimiter, caller: (r) => r.headers.get("cf-connecting-ip") ?? "unknown" }
    : null;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const incoming = new URL(request.url);

    // Firebase's sign-in pages, served from our own address
    if (isAuthProxyPath(incoming.pathname)) return proxyAuth(request, incoming, env.FIREBASE_PROJECT_ID);

    // Voice-talent jobs live here, not on the Express API.
    if (incoming.pathname === "/api/jobs" || incoming.pathname.startsWith("/api/jobs/")) {
      return handleJobs(request, incoming, env);
    }

    // Sign-in
    if (incoming.pathname.startsWith("/api/auth/")) {
      const a = authEnv(env);
      const rest = incoming.pathname.slice("/api/auth/".length).split("/").filter(Boolean);
      // Routes this Worker implements; the rest (admin codes, tickets, account deletion) still go to API_ORIGIN
      if (a && ["google", "session", "me", "signout", "profile"].includes(rest[0] ?? "") && rest.length === 1) return handleAuth(request, rest, a);
    }

    // Liveness only: which keys are set is not public information
    if (incoming.pathname === "/api/health" && request.method === "GET") {
      return new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), { headers: { ...jsonHeaders, "cache-control": "no-store" } });
    }

    // Templates and the sound library need sign-in, so they run here only when sign-in does; otherwise they go to API_ORIGIN as before
    if (incoming.pathname === "/api/templates" || incoming.pathname.startsWith("/api/templates/")) {
      const a = authEnv(env);
      if (a && env.AUTH_DB) {
        const rest = incoming.pathname.slice("/api/templates".length).split("/").filter(Boolean);
        return handleTemplates(request, rest, { auth: a, templates: new D1TemplateStore(env.AUTH_DB), limits: templateLimits });
      }
    }
    // Connection servers for the voice call; anyone with an open event's link may ask (the credentials are short-lived)
    if (incoming.pathname.startsWith("/api/live/ice/") && request.method === "GET" && env.AUTH_DB) {
      const token = incoming.pathname.slice("/api/live/ice/".length).split("/")[0] ?? "";
      if (roomLimit.take(request.headers.get("cf-connecting-ip") ?? "local")) return new Response(JSON.stringify({ error: "Too many requests." }), { status: 429, headers: jsonHeaders });
      const e = /^[A-Za-z0-9_-]{8,64}$/.test(token) ? await new D1LiveStore(env.AUTH_DB as unknown as D1Full).byToken(token) : null;
      if (!e || stateOf(e, Date.now()) === "ended" && !(e.endedAt && Date.now() - e.endedAt < 12 * 3600_000)) return new Response(JSON.stringify({ error: "This link is not valid." }), { status: 404, headers: jsonHeaders });
      return new Response(JSON.stringify(await iceServersForEvent(env, new D1RelayLedger(env.AUTH_DB as unknown as D1Full), e.id, Date.now())), { headers: { ...jsonHeaders, "cache-control": "no-store" } });
    }
    if (incoming.pathname.startsWith("/api/live/room/") && env.LIVE_ROOM) {
      const a = authEnv(env);
      if (a && env.AUTH_DB) {
        const token = incoming.pathname.slice("/api/live/room/".length).split("/")[0] ?? "";
        return handleRoomConnect(request, token, { auth: a, store: new D1LiveStore(env.AUTH_DB as unknown as D1Full), rooms: env.LIVE_ROOM, limiter: roomLimit });
      }
    }
    if (incoming.pathname.startsWith("/api/live/")) {
      const a = authEnv(env);
      if (a && env.AUTH_DB) {
        const rest = incoming.pathname.slice("/api/live/".length).split("/").filter(Boolean);
        return handleLive(request, rest, { auth: a, store: new D1LiveStore(env.AUTH_DB as unknown as D1Full), limits: liveLimits });
      }
    }
    if (incoming.pathname.startsWith("/api/freesound/")) {
      const a = authEnv(env);
      if (a) {
        const rest = incoming.pathname.slice("/api/freesound/".length).split("/").filter(Boolean);
        return handleFreesound(request, rest, { auth: a, apiKey: env.FREESOUND_API_KEY, clientId: env.FREESOUND_CLIENT_ID, clientSecret: env.FREESOUND_CLIENT_SECRET, tokens: env.AUTH_DB ? new D1TokenStore(env.AUTH_DB, makeSealer(a.sessionSecret)) : undefined, limits: freesoundLimits });
      }
    }

    // Keep the existing Express API as the origin while Cloudflare serves the app.
    // This avoids pretending the Express server is already compatible with Workers.
    if (incoming.pathname === "/api" || incoming.pathname.startsWith("/api/")) {
      if (!env.API_ORIGIN) {
        return new Response(
          JSON.stringify({
            error: "The API origin is not configured for this deployment.",
          }),
          { status: 503, headers: jsonHeaders },
        );
      }

      let apiOrigin: URL;
      try {
        apiOrigin = new URL(env.API_ORIGIN);
        if (apiOrigin.protocol !== "https:") {
          throw new Error("API_ORIGIN must use HTTPS.");
        }
      } catch {
        return new Response(
          JSON.stringify({ error: "The API origin configuration is invalid." }),
          { status: 500, headers: jsonHeaders },
        );
      }

      const target = new URL(
        `${incoming.pathname}${incoming.search}`,
        apiOrigin,
      );
      const proxiedRequest = new Request(target.toString(), request);
      proxiedRequest.headers.set("x-forwarded-host", incoming.host);
      proxiedRequest.headers.set("x-forwarded-proto", incoming.protocol.slice(0, -1));

      try {
        return await fetch(proxiedRequest);
      } catch {
        return new Response(
          JSON.stringify({ error: "The API service could not be reached." }),
          { status: 502, headers: jsonHeaders },
        );
      }
    }

    // The home page carries its own address in the link-preview tags (WhatsApp and others need a full address for the image)
    if ((request.method === "GET" || request.method === "HEAD") && (incoming.pathname === "/" || incoming.pathname === "/index.html")) {
      const page = await env.ASSETS.fetch(new Request(`${incoming.origin}/`, { headers: request.headers }));
      if (page.ok && (page.headers.get("content-type") ?? "").includes("text/html")) {
        const headers = new Headers(page.headers);
        headers.delete("content-length"); headers.delete("etag"); headers.set("cache-control", "no-cache");
        return new Response(request.method === "HEAD" ? null : withOrigin(await page.text(), incoming.origin), { status: 200, headers });
      }
      return page;
    }

    // Vite builds the React SPA to ./dist; Cloudflare serves and caches those assets.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

const hex = (n: number): string => {
  const b = crypto.getRandomValues(new Uint8Array(n));
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
};

async function handleJobs(request: Request, url: URL, env: Env): Promise<Response> {
  const rest = url.pathname.split("/").filter(Boolean).slice(2); // after api, jobs
  if (rest[0] === "ping" && request.method === "GET") {
    return new Response(JSON.stringify({ ok: true, createRequiresCode: Boolean(env.JOBS_CREATE_CODE) }), { headers: jsonHeaders });
  }
  if (rest[0] === "_status" && request.method === "GET") {
    if (!env.JOB_REGISTRY) return new Response(JSON.stringify({ mode: "unguarded" }), { headers: jsonHeaders });
    return env.JOB_REGISTRY.get(env.JOB_REGISTRY.idFromName("main")).fetch(new Request("https://registry/status"));
  }
  if (rest.length === 0 && request.method === "POST") {
    if (env.JOBS_CREATE_CODE && request.headers.get("x-jobs-create-code") !== env.JOBS_CREATE_CODE) {
      return new Response(JSON.stringify({ error: "A code is needed to create jobs." }), { status: 403, headers: jsonHeaders });
    }
    if (env.JOB_REGISTRY) {
      // Fails closed: if the limit cannot be checked, no job is created
      let gate: { ok: boolean; refusal?: string; retryAfterSeconds?: number } = { ok: false, refusal: "Jobs cannot be created right now. Try again shortly.", retryAfterSeconds: 60 };
      try {
        const r = await env.JOB_REGISTRY.get(env.JOB_REGISTRY.idFromName("main")).fetch(new Request("https://registry/create", { method: "POST", body: JSON.stringify({ address: request.headers.get("cf-connecting-ip") ?? "" }) }));
        if (r.ok) gate = (await r.json()) as typeof gate;
      } catch { /* keeps the refusal above */ }
      if (!gate.ok) return new Response(JSON.stringify({ error: gate.refusal }), { status: 429, headers: { ...jsonHeaders, "retry-after": String(gate.retryAfterSeconds ?? 60) } });
    }
    const id = hex(16);
    const stub = env.JOB_ROOM.get(env.JOB_ROOM.idFromName(id));
    const init = await stub.fetch(new Request(new URL(`/api/jobs/${id}/init`, url), { method: "POST", body: request.body, headers: { "content-type": "application/json" } }));
    if (!init.ok) return init;
    const keys = (await init.json()) as Record<string, string>;
    return new Response(JSON.stringify({ jobId: id, ...keys }), { status: 201, headers: jsonHeaders });
  }
  if (/^[0-9a-f]{32}$/.test(rest[0] ?? "")) {
    const stub = env.JOB_ROOM.get(env.JOB_ROOM.idFromName(rest[0]));
    return stub.fetch(request);
  }
  return new Response(JSON.stringify({ error: "Not found." }), { status: 404, headers: jsonHeaders });
}
