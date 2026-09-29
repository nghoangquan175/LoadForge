# LoadForge API. Build from the repo root:
#   docker build -f apps/server/Dockerfile -t loadforge-server .

FROM node:22-alpine AS base
WORKDIR /app
# npm 10 fails to install this workspace, see README.
RUN npm install -g npm@11
# Every workspace manifest is needed for `npm ci` to accept the lockfile.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/dashboard/package.json apps/dashboard/

FROM base AS build
RUN npm ci --workspace @loadforge/server
COPY apps/server apps/server
RUN npm run build --workspace @loadforge/server

FROM base AS deps
RUN npm ci --workspace @loadforge/server --omit=dev

FROM node:22-alpine
# Links the GHCR package to the repo, so it inherits its private visibility.
LABEL org.opencontainers.image.source=https://github.com/nghoangquan175/LoadForge
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/server/package.json apps/server/
COPY --from=build /app/apps/server/dist apps/server/dist
WORKDIR /app/apps/server
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
