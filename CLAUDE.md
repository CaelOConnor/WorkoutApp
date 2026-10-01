# WorkoutApp

Workout tracker: log sets (exercise, reps, weight) and chart progress over time.

## Stack
- **mobile/**: Expo SDK 57 + React Native 0.86, Expo Router (file-based routes in `src/app/`). Already `.tsx` with `strict: true` from the Expo template, but loosely typed (e.g. untyped `fetch` responses) and still mostly template screens. See `mobile/CLAUDE.md`: read the Expo v57 docs before writing mobile code.
- **backend/**: Node 24, Express 5, TypeScript 7 (strict, `noUncheckedIndexedAccess`), CommonJS. `tsx` for dev, `tsc` for build.
- **DB**: PostgreSQL 16 via `pg` (raw SQL, no ORM). Schema in `backend/db/init/schema.sql`, run by the Postgres container on first start only.
- **Auth**: bcrypt password hashes, JWT (`jsonwebtoken`, 7-day expiry). `JWT_SECRET` and `DATABASE_URL` come from `backend/.env` (not committed).
- **Tests**: Vitest + supertest (backend).
- **Docker Compose**: `postgres` + `backend` services.

## Layout
```
backend/
  src/app.ts            Express app and routes (exported, no listen)
  src/index.ts          Entry point: app.listen
  src/validation.ts     Runtime type guards for request bodies
  src/types/models.ts   Shared types (no server-only imports; mobile will reuse)
  src/db/pool.ts        pg Pool;  src/db/seed.ts  seed data
  db/init/schema.sql    Tables: users, exercises, workouts, sets
  test/                 Vitest tests
mobile/src/app/         Expo Router screens; components/, constants/, hooks/
docs/ROADMAP.md         Known next tasks
```

## Commands (run in backend/)
- `npm run dev`: tsx watch server on :3000
- `npm run typecheck`: `tsc --noEmit`
- `npm test`: Vitest, single run
- `npm run build` / `npm start`: compile to `dist/` / run compiled
- `npm run seed`: seed a test user and exercises
- Root: `docker compose up -d postgres` (DB only) or `docker compose up --build`
- mobile/: `npm start` (Expo), `npm run lint`

## Working rules
- **Never commit or push.** The user reviews and commits.
- **TDD**: write a failing test first, run it to see it fail, then write the code to pass it.
- **Strict TypeScript, no `any`.** Accept `unknown` and narrow it (see `validation.ts`).
- **Learning project**: explain TypeScript and testing concepts as you go, briefly, in replies and short code comments.
