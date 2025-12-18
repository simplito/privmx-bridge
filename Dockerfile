FROM hub.simplito.com/public/node:22.11.0-bullseye-slim AS base


FROM base AS builder
RUN apt update && apt install -y python3 build-essential
COPY . /app
ARG MONGO_URL
ARG E2E_TESTS
RUN cd /app && ./scripts/build.sh
RUN cd /app && ./scripts/build-panel.sh

FROM hub.simplito.com/public/slatedocs/slate AS docs
RUN rm -rf /srv/slate/source
COPY --from=builder /app/slatedocs /srv/slate/source
RUN cd /srv/slate && /srv/slate/slate.sh build --verbose

FROM base AS runner

RUN apt-get update && apt-get install -y libssl1.1

COPY --from=builder /app/docker/bin /usr/bin
COPY --from=builder /app/build /work/privmx-bridge
COPY --from=builder /app/public/panel /work/privmx-bridge/public/panel
COPY --from=docs /srv/slate/build /work/privmx-bridge/public/docs

# HEALTHCHECK --interval=10s --start-interval=2s --start-period=20s --timeout=5s --retries=5 CMD pmxbridge_up
HEALTHCHECK CMD pmxbridge_up
EXPOSE 3000

CMD ["pmxbridge"]
