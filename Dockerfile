FROM oven/bun:1.3.14-alpine AS frontend-build
WORKDIR /workspace/frontend
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile
COPY frontend/ ./
RUN bun run build

FROM oven/bun:1.3.14-alpine AS api
WORKDIR /app/backend
ENV NODE_ENV=production PORT=8787 DEMO_AUTH_ENABLED=false RUN_MIGRATIONS=false
COPY backend/package.json backend/bun.lock ./
RUN bun install --production --frozen-lockfile
COPY backend/src ./src
RUN mkdir -p /data /uploads && chown -R bun:bun /app/backend /data /uploads
USER bun
EXPOSE 8787
CMD ["bun", "run", "src/index.ts"]

FROM caddy:2.11.6-alpine AS web
COPY --from=frontend-build /workspace/frontend/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
