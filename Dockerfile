# ─── Stage 1: build frontend ──────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ─── Stage 2: production image ────────────────────────────────────────────────
FROM node:20-alpine AS runner

# dumb-init ensures Node receives OS signals (SIGTERM etc.) and shuts down
# cleanly when the container is stopped — avoids zombie processes.
RUN apk add --no-cache dumb-init

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server/ ./server/
COPY --from=builder /app/dist ./dist/

# Hand ownership to the non-root user after all files are copied
RUN chown -R appuser:appgroup /app

USER appuser

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Uses the existing /api/ping endpoint; starts checking after 10 s to give
# the server time to come up, retries 3 times before marking unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/ping || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server/index.cjs"]
