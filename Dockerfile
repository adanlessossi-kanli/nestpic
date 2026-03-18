FROM node:20-alpine AS base

# Install dependencies needed for native modules (sharp, bcrypt, ffmpeg)
RUN apk add --no-cache libc6-compat ffmpeg

WORKDIR /app

# ── deps stage: install production + dev deps for build ──────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ── builder stage: build the Next.js app ─────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Stub env vars required at build time (no real credentials needed)
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nestpic
ENV SESSION_SECRET=stub-session-secret-for-build-only-not-real
ENV OBJECT_STORE_ENDPOINT=http://localhost:8080
ENV OBJECT_STORE_ACCESS_KEY=stub
ENV OBJECT_STORE_SECRET_KEY=stub
ENV OBJECT_STORE_BUCKET=nestpic
ENV CDN_BASE_URL=http://localhost:8080
ENV CDN_KEY_PAIR_ID=stub
ENV CDN_PRIVATE_KEY=stub
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── runner stage: minimal production image ────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
