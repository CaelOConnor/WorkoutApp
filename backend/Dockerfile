# Stage 1: install all deps (including TypeScript) and compile src/ -> dist/
FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: runtime image with only production deps and the compiled JS
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
