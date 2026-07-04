# Chainstitch — self-hosted image (SQLite persisted under /app/data).
# Build:  docker build -t chainstitch .
# Run:    docker run -p 3000:3000 -v ./data:/app/data chainstitch
# node:22-slim (glibc) so better-sqlite3's prebuilt native binding loads.

FROM node:22-slim AS deps
WORKDIR /app
# python3/make/g++: some transitive native modules (e.g. utf-8-validate via
# the MetaMask SDK) ship no linux-arm64 prebuilds and must compile from source.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc* ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000

RUN groupadd --system nodejs && useradd --system --gid nodejs nextjs \
  && mkdir -p /app/data && chown nextjs:nodejs /app/data

# Standalone output bundles the server and the traced node_modules subset
# (including better-sqlite3's native binding).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
VOLUME /app/data
EXPOSE 3000
CMD ["node", "server.js"]
