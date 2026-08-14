# syntax=docker/dockerfile:1

# Eventini API — sprint-02 EVT-013.
#
# ## Base image
#
# `bookworm-slim` (glibc) rather than Alpine (musl). Two production
# dependencies ship native code — `argon2` and `sharp` — and both publish
# prebuilt glibc binaries. On musl they are either compiled from source, which
# means dragging a full toolchain into the image, or resolved through separate
# `-musl` optional packages that npm silently skips when the install platform
# and the target disagree. The result is a module that installs cleanly and
# throws on first use, which is the worst place to find out.
#
# ## Digest pinning
#
# The tag is deliberately not pinned to a digest here. `node:24-bookworm-slim`
# is rebuilt to pick up Debian security patches, and pinning would freeze
# those out until someone remembers to bump it. Reproducibility comes from
# `package-lock.json`, which is what actually determines application
# behaviour. A release pipeline that needs byte-identical rebuilds should pin
# the digest at that point, where the trade-off is a deliberate choice.

ARG NODE_IMAGE=node:24-bookworm-slim


# --- deps -------------------------------------------------------------------
# Full dependency tree, dev included, because the build needs the compiler and
# the Nest CLI.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# Only the manifests, so this layer is reused on every build that does not
# change a dependency — which is nearly all of them.
COPY package.json package-lock.json ./

# `npm ci` rather than `npm install`: it installs exactly the lockfile and
# fails if the manifest and lock disagree, instead of quietly resolving to
# something newer than what was reviewed and tested.
RUN npm ci


# --- build ------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

# Compiles with tsconfig.build.json: `src` only, `types: ["node"]`. A Jest
# global that leaked into application code fails here rather than shipping.
#
# TODO(EVT-014, sprint 03): add `npx prisma generate` once prisma/schema.prisma
# exists. Nothing imports @prisma/client yet, so generating now would only
# fail on a missing schema.
RUN npm run build


# --- prod-deps --------------------------------------------------------------
# Production dependencies only, resolved in a separate stage so the final
# image never contains a compiler, the Nest CLI, or a test runner.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force


# --- runtime ----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001

# The `node` user ships with the image at uid 1000. Running as root would mean
# a container escape starts with root on the host, and it also lets a
# compromised process rewrite its own application code. Nothing here needs to
# write to the filesystem at all.
#
# Ownership is set at COPY time via `--chown` rather than with a later
# `chown -R`, which would duplicate the whole tree into a second layer.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node docker-healthcheck.mjs ./

USER node

EXPOSE 3001

# Explicit, because Docker's default is already SIGTERM but an inherited
# STOPSIGNAL from a future base image change would silently break shutdown.
# Nest's `enableShutdownHooks()` listens for SIGTERM; without it the container
# is killed with SIGKILL after the grace period, cutting transactions
# mid-flight and orphaning queue jobs.
STOPSIGNAL SIGTERM

# Uses Node rather than curl or wget, neither of which is in this image.
# Installing one for the healthcheck would add a shell-capable HTTP client to
# an image that otherwise has none — useful to an attacker, unnecessary to us.
#
# `start-period` is generous because the process validates ~130 environment
# variables and verifies two Ed25519 key pairs before it listens; failing the
# check during that window would restart the container in a loop.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD ["node", "docker-healthcheck.mjs"]

# `node dist/main` directly, never `npm start`. npm would sit between the init
# process and Node, and it does not forward SIGTERM to its child — so the
# shutdown hooks above would never run. This also makes Node PID 1's direct
# child, so signals arrive where they are handled.
CMD ["node", "dist/main"]
