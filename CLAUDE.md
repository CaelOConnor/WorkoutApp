# WorkoutApp

Workout tracker: log sets (exercise, reps, weight) and chart progress over time.

## Stack
- **mobile/**: Expo SDK 57 + React Native 0.86, Expo Router (file-based routes in `src/app/`). Already `.tsx` with `strict: true` from the Expo template, but loosely typed (e.g. untyped `fetch` responses) and still mostly template screens. See `mobile/CLAUDE.md`: read the Expo v57 docs before writing mobile code.
- **backend/**: Node 24, Express 5, TypeScript 7 (strict, `noUncheckedIndexedAccess`), CommonJS. `tsx` for dev, `tsc` for build.
- **DB**: PostgreSQL 16 via `pg` (raw SQL, no ORM). Schema is managed by node-pg-migrate: plain-SQL migrations in `backend/migrations/`, tracked in the `pgmigrations` table. Never edit a migration that has run; add a new one.
- **Auth**: bcrypt password hashes, JWT (`jsonwebtoken`, 7-day expiry). `JWT_SECRET` and `DATABASE_URL` come from `backend/.env` (not committed).
- **Tests**: Vitest + supertest (backend); Jest via `jest-expo` with a mocked `fetch` (mobile).
- **Docker Compose**: `postgres` + `backend` services.

## Layout
```
backend/
  src/app.ts            Express app: middleware, routers, error handler (exported, no listen)
  src/routes/           express.Router per area: auth, workouts (+ nested sets), exercises, health
  src/index.ts          Entry point: app.listen
  src/validation.ts     Runtime type guards for request bodies
  src/types/models.ts   Shared types (no server-only imports; mobile will reuse)
  src/db/pool.ts        pg Pool;  src/db/seed.ts  seed data;  src/db/ also has shared queries
  migrations/           SQL migrations (Up/Down); tables: users, exercises, workouts, workout_exercises, sets
  test/                 Vitest tests
mobile/src/app/         Expo Router screens; components/, constants/, hooks/
mobile/src/api/         API client (request<T> + error classes), response type guards, API URL
mobile/src/auth/        AuthProvider (useAuth/useApi), SecureStore token, splash screen controller
                        Backend types via the `@shared/models` alias (type-only imports; verbatimModuleSyntax)
docs/ROADMAP.md         Known next tasks
```

## Commands (run in backend/)
- `npm run dev`: tsx watch server on :3000
- `npm run typecheck`: `tsc --noEmit`
- `npm test`: Vitest, single run, inside a Linux container (`backend-test` in `docker-compose.yml`; needs Docker Desktop running, starts `postgres-test` itself). Extra args go to Vitest: `npm test -- test/templates.test.ts`, `npm test -- -t "409"`. Source is mounted read-only, so no rebuild after edits; a lockfile change reinstalls on the next run (`--build`).
- `npm run test:local`: the same Vitest run directly on Windows (needs `docker compose up -d postgres-test`); hits the intermittent worker crash (see ROADMAP Known issues). `npm run test:watch` is local too.
- `npm run build` / `npm start`: compile to `dist/` / run compiled
- `npm run seed`: seed a test user and exercises (safe to rerun)
- `npm run seed:sample [-- email]`: replace a user's sample workouts (notes start `Sample:`) with ~3 weeks ending today; default `you@test.com`, dev DB only (refuses `*_test`), needs `npm run seed` first
- `npm run migrate:create -- <name>` / `migrate:up` / `migrate:down`: new SQL migration / apply pending / roll back the last one (uses `DATABASE_URL` from `.env`)
- Root: `docker compose up -d postgres` (DB only) or `docker compose up --build` (backend runs migrations on start). Tests rebuild the test DB from migrations.
- Tests use the separate `postgres-test` container (database `workoutapp_test`; `postgres-test:5432` inside Compose, `localhost:5433` from the host), never the dev DB on 5432.
- mobile/: `npm start` (Expo), `npm test` (Jest), `npm run typecheck` (includes tests), `npm run lint`. API URL: `EXPO_PUBLIC_API_URL` in `mobile/.env.local`, else in dev the Metro host LAN IP + `:3000`.

## Working rules
- **Never commit or push.** The user reviews and commits.
- **Ask before any git command that changes the working tree, index, or history** (e.g. `stash`, `reset`, `checkout`, `restore`, `rm`, `commit`). Read-only commands like `status`, `diff`, and `log` are fine.
- **TDD**: write a failing test first, run it to see it fail, then write the code to pass it.
- **Strict TypeScript, no `any`.** Accept `unknown` and narrow it (see `validation.ts`).
- **Learning project**: explain TypeScript and testing concepts as you go, briefly, in replies and short code comments.
