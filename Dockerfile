# Uuda Studio API for Cloud Run
# Builds the web app and the server bundle, then ships only what the server needs at runtime.
# (Firebase Hosting serves the web app in production; the server also serves it, which is useful for previews.)

FROM node:22-slim AS build
WORKDIR /app
COPY package.json ./
# No lockfile is committed yet; once one exists, switch this line to `npm ci`.
COPY package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build:all

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
# Firebase project id is read from this file when FIREBASE_PROJECT_ID is not set
COPY firebase-applet-config.json ./firebase-applet-config.json
USER node
# Cloud Run sets PORT (8080)
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist-server/server.js"]
