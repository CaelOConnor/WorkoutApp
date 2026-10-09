# Roadmap

## Vision
A mobile workout tracker (eventually on the App Store and Google Play). A user logs a workout for a day: multiple exercises, each with sets of reps and weight. They can edit or delete past workouts and sets, browse their history by week, and see a progress chart for any exercise over time. Being able to change the schema safely as features are added is a priority.

## Done
- [x] Auth middleware; `POST /workouts` saves for the token's user.
- [x] `GET /workouts` returns only the logged-in user's workouts.
- [x] `POST /workouts` with an unknown `exercise_id` returns 400 (catches FK violation 23503 on `sets_exercise_id_fkey`, after ROLLBACK).

## Phase 1: Migrations
- [x] node-pg-migrate with plain-SQL migrations in `backend/migrations/`; `schema.sql` became the baseline. Tests and Docker startup run the migrations.
- [x] `docker-compose.yml`: Postgres healthcheck; the backend waits for it before migrating.
- [x] Seed is safe to rerun (unique index on `exercises (created_by, name)` + `ON CONFLICT DO NOTHING`).

## Phase 2: Edit and delete API (TDD)
- [x] Get one workout, edit a workout, delete a workout, edit or delete a single set (`PATCH`/`DELETE /workouts/:id/sets/:setId`, nested router in `src/routes/sets.ts`).
- [x] Empty workouts are allowed: both `GET /workouts` and `GET /workouts/:id` give `sets: []`.
- [x] `GET /workouts` returns `WorkoutDetail[]` (same shape as `GET /workouts/:id`), newest date first, then id. Two queries in total (workouts, then all their sets via `workout_id = ANY($1)`), not one per workout. Replaced the flat one-row-per-set `WorkoutHistoryRow`.
- [ ] Paginate `GET /workouts`: it returns every workout the user has ever logged. Keyset (cursor) pagination on `(date, id)` fits the existing order, e.g. `?before_date=&before_id=&limit=`, and stays correct when workouts are added between pages (unlike `OFFSET`). Do it alongside the history-by-week screen, which may want a date range (`?from=&to=`) instead.
- [x] `POST /workouts/:id/sets` adds one set to an existing workout (including an emptied one) and returns 201 with the full `WorkoutDetail`. `set_number` is optional; when missing, the server uses the workout's highest + 1 (1 if it has no sets), or 409 if that would pass the `INTEGER` max.
- [x] Set values the columns can't store are a 400, not a 500 or a silent round: weight must fit `NUMERIC(6,2)` (≤ 9999.99, at most 2 decimals), and `reps`, `set_number`, `exercise_id` must fit `INTEGER` (≤ 2147483647). Applies to `POST /workouts` and `PATCH .../sets/:setId`.
- [ ] `set_number` is client-supplied with no uniqueness or contiguity; deleting a set leaves gaps (1, 3) and duplicates are possible. Decide when adding/reordering sets in the app.
  - `POST /workouts/:id/sets` assigns highest + 1 when `set_number` is missing. Two concurrent adds to the same workout can both read the same highest number and save a duplicate: computing it inside the `INSERT` narrows the window but doesn't close it under `READ COMMITTED`. Unlikely with one user on one phone. A real fix is a `UNIQUE (workout_id, set_number)` constraint (then retry on 23505) or locking the workout row (`SELECT ... FOR UPDATE`); the constraint needs existing duplicates cleaned up first, so decide it with the gaps question.
- [ ] Signup: no email format or minimum password length check.
- [x] Split routes out of `app.ts` into `express.Router` files in `src/routes/` (auth, workouts, exercises, health). `requireAuth` runs on the whole workouts router.

## Phase 3: App screens
- [ ] Log today's workout; history list grouped by week; workout detail with edit/delete.
- [ ] Groundwork: real `API_URL` (placeholder in `signup.tsx`), login screen, token storage (Expo SecureStore), replace the Home/Explore template screens.
- [ ] Type the app: `fetch` responses are `any`. Reuse `backend/src/types/models.ts` (shared package or path alias) and validate responses.

## Phase 4: Progress charts
- [ ] Weight as a number: `pg` returns `NUMERIC` as a string (`"135.00"`). Parse it (or register a pg type parser) and change `WorkoutSet.weight` to `number`.
- [ ] DATE time zone: `pg` turns a `DATE` into a JS `Date` at local midnight, then `res.json` sends it as a UTC ISO string, so the day can shift depending on the server's time zone. Return `'YYYY-MM-DD'` instead (pg type parser for OID 1082, or `to_char` in SQL) and change `Workout.date` to `string`. Then tighten the `date: expect.any(String)` assertion in the `GET /workouts/:id` test.
- [ ] Endpoint for one exercise's progress over time (e.g. top weight or volume per date).
- [ ] Chart screen (Victory Native or react-native-gifted-charts, per Notes.md).

## Phase 5: Templates
- [ ] Save a reusable workout (e.g. "leg day") as a list of exercises.
- [ ] Start a new workout from a template so only the numbers need filling in.

## Known issues
- **Intermittent Vitest worker crash on Windows.** About 7% of `npm test` runs (6 of 90 measured, 2026-10-08) end with `Worker exited unexpectedly with exit code 3221226505` (`0xC0000409`, a native fast-fail), always while running `test/workouts.test.ts`. The rest of the suite passes; rerunning gets a clean run. Seen on the untouched tree too, so it isn't caused by a specific change. Node 24.15, Vitest 5.0.3, `pool: 'forks'` (default).
  - Ruled out: `pool: 'threads'` (same rate, ~4 in 60, and worse: the whole Vitest process dies with no summary, so failures are silent); swapping `bcrypt` for `bcryptjs` (crashed 2 of the first 7 runs with no native bcrypt loaded).
  - Not yet tried: `isolate: false`, `pg` native bindings (not used, but worth confirming), a different Node 24 patch or Node 22, splitting `workouts.test.ts` (largest file) to see if size or run time matters.

## Later
- Other activity types: climbing, running, swimming.
- Offline logging with SQLite on the device, plus sync to the server.
- Publish to the App Store and Google Play.
- Move config like `JWT_SECRET` into `src/config.ts`.
- Linting on the backend.
- Split routes further into controllers → services → repositories (per Notes.md), only if route files get hard to work with.
