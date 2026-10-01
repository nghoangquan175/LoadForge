# LoadForge dashboard. Build from the repo root:
#   docker build -f apps/dashboard/Dockerfile -t loadforge-dashboard .
# Login secrets are runtime env: DASHBOARD_USER, DASHBOARD_PASSWORD, AUTH_SECRET.

FROM node:22-alpine AS build
WORKDIR /app
# npm 10 fails to install this workspace, see README.
RUN npm install -g npm@11
# Every workspace manifest is needed for `npm ci` to accept the lockfile.
COPY package.json package-lock.json ./
COPY apps/defender/package.json apps/defender/
COPY apps/watcher/package.json apps/watcher/
COPY apps/dashboard/package.json apps/dashboard/
RUN npm ci --workspace @loadforge/dashboard
COPY apps/dashboard apps/dashboard
# Empty = same origin: the ALB sends /api/* to the Defenders, /monitor/* to the Watcher.
ARG NEXT_PUBLIC_API_URL=""
ARG NEXT_PUBLIC_WATCHER_URL=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WATCHER_URL=$NEXT_PUBLIC_WATCHER_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace @loadforge/dashboard

FROM node:22-alpine
# Links the GHCR package to the repo, so it inherits its private visibility.
LABEL org.opencontainers.image.source=https://github.com/nghoangquan175/LoadForge
ENV NODE_ENV=production \
    PORT=3100 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/dashboard/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/dashboard/.next/static apps/dashboard/.next/static
USER node
EXPOSE 3100
CMD ["node", "apps/dashboard/server.js"]
