# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS dependencies
WORKDIR /build/demos/catalogs
COPY demos/catalogs/package.json demos/catalogs/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
FROM dependencies AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY demos/catalogs/ ./
COPY web/app/globals.css /build/web/app/globals.css
COPY scripts/import/pricat-store.cjs /build/scripts/import/pricat-store.cjs
COPY scripts/storefront/assortment.cjs scripts/storefront/catalog.cjs scripts/storefront/search.cjs /build/scripts/storefront/
RUN npm run typecheck && npm run build
FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS runtime
ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision=$SOURCE_REVISION org.opencontainers.image.source="https://github.com/stron111-web/elektrikamarket"
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app/demos/catalogs
COPY --from=build --chown=node:node /build/demos/catalogs/.next/standalone/ /app/
COPY --from=build --chown=node:node /build/demos/catalogs/.next/static/ ./.next/static/
COPY --from=build --chown=node:node /build/demos/catalogs/public/ ./public/
COPY --from=build --chown=node:node /build/scripts/storefront/ /app/scripts/storefront/
COPY --from=build --chown=node:node /build/scripts/import/pricat-store.cjs /app/scripts/import/pricat-store.cjs
COPY --chown=node:node deploy/catalog-demos/start.cjs /app/demo-start.cjs
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node","-e","fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node","/app/demo-start.cjs"]
