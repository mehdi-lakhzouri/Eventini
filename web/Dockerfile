# syntax=docker/dockerfile:1

# Eventini web — sprint-02 EVT-013.
#
# Same base as the backend (`node:24-bookworm-slim`) so both images share
# layers and one Debian security bump covers the pair. See
# `backend/Dockerfile` for why glibc over musl, and why the tag is not pinned
# to a digest.

ARG NODE_IMAGE=node:24-bookworm-slim


# --- deps -------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci


# --- build ------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

COPY . .

# Telemetry is off during the build as well as at runtime: a build agent
# should not be making outbound calls that the person reading the Dockerfile
# did not ask for.
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

# NEXT_PUBLIC_* values are inlined into the client bundle at build time, not
# read at runtime. So the API URL has to be supplied here, and an image built
# for one environment cannot be promoted to another — which is a property of
# Next.js, not a choice made here, and is called out in the sprint doc.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

RUN npm run build


# --- runtime ----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    # Without this the standalone server binds 127.0.0.1 inside the container,
    # so nothing outside it — including Docker's own port mapping — can reach
    # the process, and the container looks dead while running perfectly.
    HOSTNAME=0.0.0.0

# `nextjs` rather than the image's built-in `node` user, purely so the
# ownership of the app directory is unambiguous when reading `ls -l` during an
# incident. uid 1001 keeps it distinct from uid 1000 that the backend uses.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# The three pieces the standalone output needs, and nothing else. No
# `node_modules` copy: the traced server already embeds what it reaches.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
# `public` and `.next/static` are excluded from the standalone bundle by
# design — Next assumes a CDN serves them. Copying them in makes the container
# self-sufficient, which is what `output.md` prescribes for this case.
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --chown=nextjs:nodejs docker-healthcheck.mjs ./

USER nextjs

EXPOSE 3000

STOPSIGNAL SIGTERM

# Probes `/`, which is the only route guaranteed to exist and to need no
# backend. Next.js has no built-in health endpoint, and pointing this at a
# page that calls the API would restart the web container whenever the API is
# briefly down — the live/ready confusion EVT-012 exists to avoid, arrived at
# from the other direction.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "docker-healthcheck.mjs"]

# `server.js` is what `output: "standalone"` emits. Run directly rather than
# through npm, which would not forward SIGTERM to its child and so would turn
# every graceful stop into a SIGKILL.
CMD ["node", "server.js"]
