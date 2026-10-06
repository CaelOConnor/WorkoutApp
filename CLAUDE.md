# WorkoutApp

Workout tracker: log sets (exercise, reps, weight) and chart progress over time.

## Stack
- **mobile/**: Expo SDK 57 + React Native 0.86, Expo Router (file-based routes in `src/app/`). Already `.tsx` with `strict: true` from the Expo template, but loosely typed (e.g. untyped `fetch` responses) and still mostly template screens. See `mobile/CLAUDE.md`: read the Expo v57 docs before writing mobile code.
- **backend/**: Node 24, Express 5, TypeScript 7 (strict, `noUncheckedIndexedAccess`), CommonJS. `tsx` for dev, `tsc` for build.
- **DB**: PostgreSQL 16 via `pg` (raw SQL, no ORM). Schema is managed by node-pg-migrate: plain-SQL migrations in `backend/migrations/`, tracked in the `pgmigrations` table. Never edit a migration that has run; add a new one.
- **Auth**: bcrypt password hashes, JWT (`jsonwebtoken`, 7-day expiry). `JWT_SECRET` and `DATABASE_URL` come from `backend/.env` (not committed).
- **Tests**: Vitest + supertest (backend).
- **Docker Compose**: `postgres` + `backend` services.

## Layout
```
backend/
  src/app.ts            Express app: middleware, routers, error handler (exported, no listen)
  src/routes/           express.Router per area: auth, workouts, exercises, health
  src/index.ts          Entry point: app.listen
  src/validation.ts     Runtime type guards for request bodies
  src/types/models.ts   Shared types (no server-only imports; mobile will reuse)
  src/db/pool.ts        pg Pool;  src/db/seed.ts  seed data
  migrations/           SQL migrations (Up/Down); tables: users, exercises, workouts, sets
  test/                 Vitest tests
mobile/src/app/         Expo Router screens; components/, constants/, hooks/
docs/ROADMAP.md         Known next tasks
```

## Commands (run in backend/)
- `npm run dev`: tsx watch server on :3000
- `npm run typecheck`: `tsc --noEmit`
- `npm test`: Vitest, single run
- `npm run build` / `npm start`: compile to `dist/` / run compiled
- `npm run seed`: seed a test user and exercises (safe to rerun)
- `npm run migrate:create -- <name>` / `migrate:up` / `migrate:down`: new SQL migration / apply pending / roll back the last one (uses `DATABASE_URL` from `.env`)
- Root: `docker compose up -d postgres` (DB only) or `docker compose up --build` (backend runs migrations on start). Tests rebuild the test DB from migrations.
- mobile/: `npm start` (Expo), `npm run lint`

## Working rules
- **Never commit or push.** The user reviews and commits.
- **Ask before any git command that changes the working tree, index, or history** (e.g. `stash`, `reset`, `checkout`, `restore`, `rm`, `commit`). Read-only commands like `status`, `diff`, and `log` are fine.
- **TDD**: write a failing test first, run it to see it fail, then write the code to pass it.
- **Strict TypeScript, no `any`.** Accept `unknown` and narrow it (see `validation.ts`).
- **Learning project**: explain TypeScript and testing concepts as you go, briefly, in replies and short code comments.
