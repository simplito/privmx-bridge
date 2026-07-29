ARG NODE_IMAGE=hub.simplito.com/public/node:22.22.3-trixie-slim
ARG SLATE_IMAGE=hub.simplito.com/public/slatedocs/slate


FROM ${NODE_IMAGE} AS base
SHELL ["/bin/bash", "-eo", "pipefail", "-c"]
ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false
# Keep apt caches between builds; replaces Debian's default `docker-clean` hook.
RUN rm -f /etc/apt/apt.conf.d/docker-clean \
    && echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' \
        > /etc/apt/apt.conf.d/keep-cache
WORKDIR /app


FROM base AS toolchain
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        build-essential \
        ca-certificates


# Deps layer is reused unless package*.json / .npmrc change.
FROM toolchain AS deps
COPY --link package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci


FROM deps AS builder
COPY --link . .

RUN --mount=type=cache,target=/root/.npm \
    npm run build && npm run gen-docs

WORKDIR /app/modules/privmx-bridge-panel
RUN --mount=type=cache,target=/root/.npm \
    { [ -f .env.local ] || printf 'VITE_PRIVMX_BRIDGE_URL=/\nVITE_LOG_LEVEL=error\n' > .env.local; } \
    && npm ci \
    && npm run build

WORKDIR /app
RUN rm -rf public/panel \
    && cp -r modules/privmx-bridge-panel/dist public/panel

ARG VERSION=dev
RUN mkdir -p build/src/docs \
    && echo "${VERSION}" > build/version \
    && cp -r out public build/ \
    && cp src/docs/docs.json build/src/docs/ \
    && cp .npmrc package.json package-lock.json LICENSE.md build/ \
    && touch build/production


# Prod-only deps installed against the packed manifest.
FROM toolchain AS prod-deps
WORKDIR /work
COPY --link --from=builder /app/build/package.json /app/build/package-lock.json /app/build/.npmrc ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev


FROM ${SLATE_IMAGE} AS docs
WORKDIR /srv/slate
RUN rm -rf source
COPY --link --from=builder /app/slatedocs ./source
RUN ./slate.sh build --verbose


FROM base AS runner

ARG VERSION=dev
ARG VCS_REF=
ARG BUILD_DATE=

LABEL org.opencontainers.image.title="privmx-bridge" \
      org.opencontainers.image.description="PrivMX Bridge" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/simplito/privmx-bridge" \
      org.opencontainers.image.url="https://privmx.dev" \
      org.opencontainers.image.documentation="https://docs.privmx.dev" \
      org.opencontainers.image.vendor="Simplito" \
      org.opencontainers.image.authors="Simplito <contact@simplito.com>"

ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends \
        tini \
        ca-certificates \
    && groupadd --system --gid 1001 privmx \
    && useradd  --system --uid 1001 --gid 1001 \
        --home-dir /work/privmx-bridge \
        --shell /usr/sbin/nologin \
        privmx \
    && mkdir -p /work/privmx-bridge \
    && chown privmx:privmx /work/privmx-bridge

WORKDIR /work/privmx-bridge

COPY --link --from=builder                     /app/docker/bin /usr/local/bin
COPY --link --from=builder   --chown=1001:1001 /app/build /work/privmx-bridge
COPY        --from=prod-deps --chown=1001:1001 /work/node_modules /work/privmx-bridge/node_modules
COPY        --from=docs      --chown=1001:1001 /srv/slate/build /work/privmx-bridge/public/docs

USER 1001:1001

EXPOSE 3000

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=10s --start-interval=2s --start-period=20s --timeout=5s --retries=5 \
    CMD ["pmxbridge_up"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["pmxbridge"]
