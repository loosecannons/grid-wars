# GRID WARS — runnable container.
# Serves the static game AND the WebSocket multiplayer relay from server.js.
FROM node:20-alpine

WORKDIR /app

# Install production dependencies first so this layer caches across code edits.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Application sources (index.html, src/, server.js, campaigns, etc.).
COPY . .

ENV NODE_ENV=production
ENV PORT=8123
EXPOSE 8123

# Container is healthy once the static index is being served.
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8123/ || exit 1

# Drop root for runtime.
USER node
CMD ["node", "server.js"]
