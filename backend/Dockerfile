# Stage 1: install all deps (including TypeScript, Vitest and other dev tools). Shared by the
# build and test stages, so a lockfile change reinstalls once for both.
FROM node:24-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Stage 2: compile src/ -> dist/
FROM deps AS build

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Test stage: only Linux node_modules. The backend-test service in docker-compose.yml mounts the
# source read-only at run time, so edits don't need a rebuild, and runs Vitest here (on Linux,
# where Windows' intermittent worker crash doesn't apply). Only built when asked for by name
# (target: test); a plain build skips it, since the final stage below doesn't depend on it.
FROM deps AS test

# Final stage (the default target): runtime image with only production deps and the compiled JS
FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY migrations ./migrations

EXPOSE 3000

# Apply pending migrations, then start the server. `&&` means a failed migration stops the
# server from starting; `exec` makes node the main process so `docker stop` signals reach it.
CMD ["sh", "-c", "node_modules/.bin/node-pg-migrate up && exec node dist/index.js"]
