FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY frontend/ ./
COPY deployments/sepolia.json /app/deployments/sepolia.json
ARG API_URL
RUN test -n "$API_URL" && VITE_API_URL="$API_URL" npm run build

FROM node:24.19.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
ARG SOURCE_COMMIT
ARG API_URL
ENV SOURCE_COMMIT=$SOURCE_COMMIT API_URL=$API_URL
COPY --from=build --chown=node:node /app/frontend/dist ./dist
COPY --chown=node:node frontend/server.mjs ./server.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
