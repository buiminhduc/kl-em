# Multi-stage build: compile with dev dependencies, ship only production dependencies and dist/.
# Node 24 is the current LTS line; it can require() the ES-module-only NestJS 12 / Kysely 0.29 packages.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# The official image ships an unprivileged "node" user (uid 1000); never run the app as root.
USER node
EXPOSE 3000
# main.js applies Kysely migrations (migrateToLatest) before it starts listening. The seed is separate.
CMD ["node", "dist/main.js"]
