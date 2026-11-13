export { JobRoom } from "./jobs/jobRoom";
export { JobRegistry } from "./jobs/jobRegistry";

export interface Env {
  ASSETS: Fetcher;
  /** One Durable Object per voice-talent job (script, message thread, audio) */
  JOB_ROOM: DurableObjectNamespace;
  /** One account-wide object that tracks audio bytes so uploads can be refused before Cloudflare's free 5 GB cap. Optional. */
  JOB_REGISTRY?: DurableObjectNamespace;
  /** Optional settings (plain numbers as text): bytes allowed in total (default 4 GB), bytes and seconds per take */
  STORAGE_LIMIT_BYTES?: string;
  MAX_TAKE_BYTES?: string;
  MAX_TAKE_SECONDS?: string;
  /** Optional. If set, creating a job needs this code (typed once in the Jobs panel). */
  JOBS_CREATE_CODE?: string;
  /**
   * Public origin of the existing Uuda Studio API service, e.g.
   * https://your-service-xxxxx-uc.a.run.app
   *
   * Set this as a Worker variable in Cloudflare. Do not include a trailing path.
   */
  API_ORIGIN?: string;
}

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const incoming = new URL(request.url);

    // Voice-talent jobs live here, not on the Express API.
    if (incoming.pathname === "/api/jobs" || incoming.pathname.startsWith("/api/jobs/")) {
      return handleJobs(request, incoming, env);
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
