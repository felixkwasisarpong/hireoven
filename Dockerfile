# Hireoven - production image (Next.js standalone)
# Coolify: build from repo root; expose port 3000; set env in UI.

FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time public envs used by client bundles. NEXT_PUBLIC_* vars are inlined
# into the browser bundle at `next build` — a runtime env var has no effect, so
# they MUST be passed as build args here.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_LOGO_DEV_TOKEN
# Defaults to true so the Google sign-in button stays hidden during the waitlist
# even if the build arg is not supplied. Set --build-arg NEXT_PUBLIC_WAITLIST_MODE=false
# to re-enable Google sign-in.
ARG NEXT_PUBLIC_WAITLIST_MODE=true
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_LOGO_DEV_TOKEN=${NEXT_PUBLIC_LOGO_DEV_TOKEN}
ENV NEXT_PUBLIC_WAITLIST_MODE=${NEXT_PUBLIC_WAITLIST_MODE}
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# sharp is a native module required by Next.js image optimisation in standalone mode.
# The standalone output tracer sometimes misses it — copy it explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/sharp ./node_modules/sharp
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@img ./node_modules/@img

# Playwright is used as the browser fallback in the description-enrichment worker
# (JOB_DESCRIPTION_ENRICHMENT_BROWSER). It's imported dynamically, so the Next
# standalone tracer drops the module — copy it explicitly like sharp — and the
# runner has no browser binary, so install chromium + its system libraries here.
# Using the copied module's own CLI guarantees the chromium revision matches the
# installed playwright version. Mirrors Dockerfile.harvester.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/playwright ./node_modules/playwright
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/playwright-core ./node_modules/playwright-core
RUN mkdir -p $PLAYWRIGHT_BROWSERS_PATH \
  && node node_modules/playwright/cli.js install --with-deps chromium \
  && chmod -R go+rX $PLAYWRIGHT_BROWSERS_PATH

# DB migrations, applied idempotently on startup (see scripts/apply-migrations.mjs).
# Bundled explicitly because the Next standalone output ships only server.js +
# traced node_modules, not the scripts/ tree. `pg` is a static app dependency so
# it's already traced into ./node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/scripts/apply-migrations.mjs ./scripts/apply-migrations.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrations ./scripts/migrations

USER nextjs
EXPOSE 3000

# Apply any pending migrations, then start the server. A migration failure is
# logged loudly but does NOT block startup — a degraded feature beats an outage,
# and the advisory lock in the runner serializes concurrent container starts.
CMD ["sh", "-c", "node scripts/apply-migrations.mjs || echo '[migrate] one or more migrations failed — see logs above'; exec node server.js"]
