# Woodlands Farm Manager: API, scheduler and the installable web app in one
# image. The phone apps (Android APK, iOS shell) point at wherever this runs.
# The web bundle is platform-independent, so it always builds natively; only
# the small runtime stage is built per architecture (amd64 and arm64).
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ARG APP_VERSION_NAME
RUN npm run build

FROM node:22-alpine
WORKDIR /app/backend
ENV NODE_ENV=production
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=web /app/frontend/dist /app/frontend/dist
ENV WEB_DIST=/app/frontend/dist MEDIA_DIR=/data/media PORT=4000
VOLUME /data
EXPOSE 4000
# Migrations run on boot (server.js); seed is idempotent and only fills gaps.
CMD ["sh", "-c", "node src/db/migrate.js && node src/db/seed.js && node src/server.js"]
