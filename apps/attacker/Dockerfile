# LoadForge Attacker: a k6 load generator with a small control API.
# Build from the repo root:
#   docker build -f apps/attacker/Dockerfile -t loadforge-attacker .

ARG K6_VERSION=2.2.0

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN npm install -g npm@11
# Every workspace manifest is needed for `npm ci` to accept the lockfile.
COPY package.json package-lock.json ./
COPY apps/defender/package.json apps/defender/
COPY apps/watcher/package.json apps/watcher/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/attacker/package.json apps/attacker/

FROM base AS build
RUN npm ci --workspace @loadforge/attacker
COPY apps/attacker apps/attacker
RUN npm run build --workspace @loadforge/attacker

# The k6 binary, from the official release.
FROM debian:bookworm-slim AS k6
ARG K6_VERSION
ADD https://github.com/grafana/k6/releases/download/v${K6_VERSION}/k6-v${K6_VERSION}-linux-amd64.tar.gz /tmp/k6.tar.gz
RUN tar -xzf /tmp/k6.tar.gz -C /tmp && mv /tmp/k6-v${K6_VERSION}-linux-amd64/k6 /usr/bin/k6

FROM node:22-bookworm-slim
LABEL org.opencontainers.image.source=https://github.com/nghoangquan175/LoadForge
ENV NODE_ENV=production \
    PORT=4200 \
    K6_SCRIPT=/app/k6/attack.js
WORKDIR /app
COPY --from=k6 /usr/bin/k6 /usr/bin/k6
COPY apps/attacker/k6 ./k6
COPY --from=build /app/apps/attacker/dist ./dist
# No runtime npm dependencies: the service uses only Node's standard library.
USER node
EXPOSE 4200
CMD ["node", "dist/main.js"]
