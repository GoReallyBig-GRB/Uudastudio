# Plugin hardening (PL-3): MUST be finished before third-party plugins are offered publicly

Status: **OPEN. Release blocker for third-party plugins.** Source: PRD sections 4, 13.5, 13.6; severity High.

## The risk
Third-party (WAM) plugin code runs inside the page with the app's own access. `src/plugins/registry.ts` currently
trusts whole hosts (unpkg.com, cdn.jsdelivr.net, esm.sh, raw.githubusercontent.com) as "verified". Anyone can publish a
file to those hosts, so a malicious plugin could read the user's Gemini key or sign-in token.

## Required work
1. `pluginCatalog` collection in Firestore: id, name, vendor, version, moduleUrl, sha256 of the exact file, kind,
   licence, status (approved | suspended | pending), approvedBy, approvedAt. Server-written only.
2. `GET /api/plugins/catalog` (signed-in users): approved entries only.
3. Loader check in `src/plugins/wamHost.ts`: download the file, compute SHA-256 in the browser, load only on a match.
   A changed file at the same URL is refused until an admin approves the new hash.
4. Admin tab and endpoints (`GET/POST/PUT /api/admin/plugins`): approve, suspend, remove. Changes need the emailed code
   entered within the last 10 minutes (step-up) and write an `auditLog` entry.
5. Remove the host allow-list (`isVerifiedWamUrl` / `isModuleOriginWhitelisted`) and the "paste any plugin URL" form in
   `PluginsRackModal.tsx`. A warned, opt-in custom-URL mode may return later; it is not part of the first release.
6. Content Security Policy lists only the exact script origins of approved plugins (generated from the catalogue at deploy).
7. Plugin UI in a sandboxed iframe (no access to project data, tokens or storage); a plugin that throws, hangs or
   outputs non-finite samples is bypassed automatically and flagged.
8. Verify each starter WAM URL against the real catalogue before listing it; drop any that do not load.

## Already in place
- A plugin that fails to load stays in the chain as a "Missing" pass-through with its settings kept; web plugins time
  out after 8 s on project open; the export skips and reports plugins it cannot apply.
- The 19 built-in plugins are part of the app and are not affected.

## Depends on
Verified server-side sign-in, Firestore repository, admin emailed-code flow (PRD Phases 0 and 1).

## Interim rule
Until this is done, do not announce or promote third-party plugin support, and do not add new hosts to the allow-list.
