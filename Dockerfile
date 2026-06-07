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

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
