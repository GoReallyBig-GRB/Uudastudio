export interface Env {
  ASSETS: Fetcher;
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
