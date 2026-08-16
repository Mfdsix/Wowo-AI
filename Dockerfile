# ─── Build stage ────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

# System deps buat Prisma di Linux
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ openssl \
  && rm -rf /var/lib/apt/lists/*

# Install deps (lockfile exact)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source + generate Prisma client (linux engine) lalu build
# DATABASE_URL dummy: cuma buat prisma generate di build-time
ENV DATABASE_URL=file:/app/data/dev.db
COPY . .
RUN npx prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── Runtime stage ──────────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# python3 + edge-tts buat fitur podcast/TTS (opsional tapi biar jalan penuh)
# ffmpeg dulu dibutuhkan buat pitch-shift (sekarang dimatiin, aman aja)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg \
  && pip3 install --break-system-packages --no-cache-dir edge-tts \
  && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# Prisma: butuh schema + migrations + CLI buat migrate deploy saat startup
COPY --from=builder --chown=nextjs:nodejs /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/generated/prisma ./src/generated/prisma
COPY --from=builder --chown=nextjs:nodejs /app/next.config.ts ./next.config.ts

# DB volume biar SQLite persist
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
ENV DATABASE_URL=file:/app/data/dev.db

USER nextjs
EXPOSE 3000

COPY --chown=nextjs:nodejs docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "start"]