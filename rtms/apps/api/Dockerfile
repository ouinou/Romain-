# syntax=docker/dockerfile:1.7
# Image de production RTMS API : multi-étapes, utilisateur non-root, système de fichiers en lecture seule.
ARG NODE_IMAGE=node:22.23-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild argon2
COPY apps/api/prisma ./prisma
RUN npx prisma generate
COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    WEB_ROOT=/app/web \
    PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/package.json ./
COPY --chown=node:node apps/web/index.html apps/web/app.js apps/web/app.css ./web/
ARG RTMS_VERSION=dev
ENV RTMS_VERSION=${RTMS_VERSION}
LABEL org.opencontainers.image.title="rtms-api" org.opencontainers.image.version="${RTMS_VERSION}"
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
