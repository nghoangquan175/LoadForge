# LoadForge Defender (API). Build from the repo root:
#   docker build -f apps/defender/Dockerfile -t loadforge-defender .

FROM node:22-alpine AS base
WORKDIR /app
# npm 10 fails to install this workspace, see README.
RUN npm install -g npm@11
# Every workspace manifest is needed for `npm ci` to accept the lockfile.
COPY package.json package-lock.json ./
COPY apps/defender/package.json apps/defender/
COPY apps/watcher/package.json apps/watcher/
COPY apps/dashboard/package.json apps/dashboard/

FROM base AS build
RUN npm ci --workspace @loadforge/defender
COPY apps/defender apps/defender
RUN npm run build --workspace @loadforge/defender

FROM base AS deps
RUN npm ci --workspace @loadforge/defender --omit=dev

FROM node:22-alpine
# Links the GHCR package to the repo, so it inherits its private visibility.
LABEL org.opencontainers.image.source=https://github.com/nghoangquan175/LoadForge
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/defender/package.json apps/defender/
COPY --from=build /app/apps/defender/dist apps/defender/dist
WORKDIR /app/apps/defender
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
