FROM node:24.19.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
ARG SOURCE_COMMIT
ARG API_URL
ENV SOURCE_COMMIT=$SOURCE_COMMIT API_URL=$API_URL
COPY --chown=node:node frontend/dist ./dist
COPY --chown=node:node frontend/server.mjs ./server.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
