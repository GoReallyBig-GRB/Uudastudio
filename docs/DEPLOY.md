# Deploying Uuda Studio (Firebase Hosting + Cloud Run + Firestore)

The browser never talks to Firestore or Storage directly. Only the Cloud Run server does, through its service account, so Firestore and Storage rules stay "deny all" for clients.

## One-time setup
1. Firebase console: upgrade the project to Blaze (Cloud Run needs billing; the free allowances still apply).
2. Enable Firestore (Native mode), Cloud Storage, Authentication (Google provider), Secret Manager, Cloud Run, Artifact Registry.
3. Give the Cloud Run runtime service account these roles: Cloud Datastore User, Storage Object Admin on the project bucket, Secret Manager Secret Accessor.
4. Firestore TTL policies (Firestore > Time-to-live), field `expires_at`, on collections: `sessions`, `adminCodes`, `verifiedAdmin`. Old records then delete themselves.
5. Secrets in Secret Manager: `GEMINI_API_KEY`, `SMTP_PASS`. Plain settings: `SUPER_ADMIN_EMAIL`, `SMTP_USER`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET` (optional).
6. GitHub: repository variable `DEPLOY_ENABLED=true` and the deploy credentials used by `.github/workflows/deploy.yml`.

## Data
- `DATA_BACKEND` defaults to `firestore` on Cloud Run and to a local file elsewhere.
- Collections: users, sessions, adminCodes, verifiedAdmin, generations, tickets, projects (details), admins, audit.
- Project contents are stored in Cloud Storage at `projects/<uid>/<projectId>.json`.
- The in-memory rate limiter is still per instance, so keep `max-instances` low (the workflow uses 1) until limits move to Firestore.

## Switching the CSP on
Run with the report-only policy first, check the browser console for violations, then set `CSP_ENFORCE=true`.
