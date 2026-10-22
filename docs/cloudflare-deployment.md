# Cloudflare Workers deployment

Target URL: https://uudastudio.goreallybig.com

## Architecture

- Cloudflare Workers Static Assets serves the Vite/React build in `dist/`.
- Requests to `/api/*` are proxied to the existing Uuda Studio API service using the Worker variable `API_ORIGIN`.
- The existing Express API is **not** running inside the Worker. This avoids silently deploying Express code that depends on Node server APIs and filesystem access into the Workers runtime.
- Firebase client services may still be used by the app. This migration changes web hosting; it does not automatically migrate Firebase Auth, Firestore, or other Firebase services.

## Required one-time Cloudflare setup

1. Add `goreallybig.com` to the Cloudflare account and make sure the zone is active. The domain route in `wrangler.jsonc` requires that zone to exist in the same Cloudflare account used for deployment.
2. Confirm the existing Express API is deployed at a stable HTTPS origin (for example, the existing Cloud Run service URL). Set Worker variable `API_ORIGIN` to that origin only, without a path or trailing slash. Do not point it at `https://uudastudio.goreallybig.com`, which would create a proxy loop.
3. In GitHub repository settings, add Actions secrets:
   - `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with permission to deploy Workers and edit the relevant zone/route.
   - `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID.
4. Add repository Actions variable `CLOUDFLARE_DEPLOY_ENABLED` with value `true` only after the zone and API origin are configured. This opt-in prevents CI from attempting deployment before the account is ready.
5. Add `uudastudio.goreallybig.com` to Firebase Authentication's authorized domains if Google/Firebase sign-in remains enabled. Check OAuth provider redirect/authorized-domain settings too.
6. Test sign-in, API health (`/api/health`), voice generation, Freesound routes, and saved project behavior on the deployed hostname before switching any remaining production traffic.

## Deploy

Once the one-time setup above is complete, every successful CI run for a push to `main` will deploy the built React assets and Worker API proxy. Pull requests only run checks.

Manual local commands:

```sh
npm install
npm run build
npx wrangler deploy
```

Wrangler uses the authenticated Cloudflare account and the route in `wrangler.jsonc`. Set `API_ORIGIN` in Worker settings before expecting API routes to work.

## Important backend limitation

This Worker does not replace the Express API host. It fronts that host through a same-origin proxy. To remove the backend host as well, the API routes, authentication integration, persistence layer, and any filesystem-backed cache must be migrated to Worker-compatible handlers and Cloudflare storage separately. Do not remove the current API service until that migration is complete and verified.
