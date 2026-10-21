FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOST=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/lib ./lib
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/next.config.mjs ./next.config.mjs
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 3000
CMD ["npm", "start"]

