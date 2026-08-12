# SunScout production image — builds frontend + API, serves both on :8787
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:api

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV API_PORT=8787
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/server ./server
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/public ./public
EXPOSE 8787
CMD ["node", "dist-server/index.js"]
