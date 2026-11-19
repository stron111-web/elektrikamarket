FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
ARG RELEASE_COMMIT
LABEL org.opencontainers.image.revision=$RELEASE_COMMIT
WORKDIR /work
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY scripts/import/*.cjs ./scripts/import/
COPY scripts/storefront/assortment.cjs ./scripts/storefront/assortment.cjs
COPY scripts/pricat-update/update.cjs scripts/pricat-update/ftps.cjs scripts/pricat-update/sync.cjs scripts/pricat-update/diagnostic-retention.cjs scripts/pricat-update/status.cjs scripts/pricat-update/worker.cjs scripts/pricat-update/source-time.cjs scripts/pricat-update/source-review.cjs scripts/pricat-update/release-policy.cjs scripts/pricat-update/reviewed-import.cjs ./scripts/pricat-update/
USER node
ENTRYPOINT ["node", "scripts/pricat-update/worker.cjs"]
