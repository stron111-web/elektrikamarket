FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS runtime
ARG RELEASE_COMMIT
LABEL org.opencontainers.image.revision=$RELEASE_COMMIT
WORKDIR /work
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY scripts/import/*.cjs ./scripts/import/
COPY scripts/storefront/assortment.cjs ./scripts/storefront/
COPY scripts/pricat-update/update.cjs scripts/pricat-update/source-time.cjs scripts/pricat-update/source-review.cjs scripts/pricat-update/release-policy.cjs scripts/pricat-update/reviewed-import.cjs ./scripts/pricat-update/
COPY scripts/prodat-update/*.cjs ./scripts/prodat-update/
RUN find scripts -name '*.test.cjs' -delete
USER node
ENTRYPOINT ["node", "scripts/prodat-update/update.cjs"]

FROM runtime AS tests
USER root
COPY prisma/migrations/ ./prisma/migrations/
COPY scripts/import/*.test.cjs ./scripts/import/
COPY scripts/prodat-update/*.test.cjs ./scripts/prodat-update/
USER node
ENTRYPOINT ["node", "--test"]
