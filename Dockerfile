# TypeScript side (tracker + dashboard). altmonitor has its own Dockerfile.
FROM node:20-bookworm-slim

WORKDIR /app

# Toolchain so better-sqlite3 builds if no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Shared DB path so the tracker and dashboard read the same file (see storage.ts).
ENV SMART_MONEY_DB_PATH=/data/snapshots.db
RUN mkdir -p /data

# Overridden per-service in docker-compose.yml.
CMD ["npx", "tsx", "src/scripts/smart-money-tick.ts"]
