FROM node:24-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    APP_MODE=remote \
    HOST=0.0.0.0 \
    PORT=8767 \
    APP_DATA_DIR=/data

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /data \
    && chown -R node:node /app /data

USER node
VOLUME ["/data"]
EXPOSE 8767
CMD ["node", "server.mjs"]
