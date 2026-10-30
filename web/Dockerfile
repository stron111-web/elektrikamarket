# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS dependencies
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM dependencies AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY web/ ./
COPY scripts/import/pricat-store.cjs /build/scripts/import/pricat-store.cjs
COPY scripts/storefront/assortment.cjs scripts/storefront/catalog.cjs /build/scripts/storefront/
RUN mkdir -p public && npm run build

FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app/web
COPY --from=build --chown=node:node /build/web/.next/standalone/ /app/
COPY --from=build --chown=node:node /build/web/.next/static/ /app/web/.next/static/
COPY --from=build --chown=node:node /build/scripts/import/pricat-store.cjs /app/scripts/import/pricat-store.cjs
COPY --from=build --chown=node:node /build/scripts/storefront/ /app/scripts/storefront/
COPY --chown=node:node deploy/storefront/start.cjs /app/start.cjs
COPY --from=build --chown=node:node /build/web/public/ /app/web/public/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "/app/start.cjs"]
