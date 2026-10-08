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
- [x] Empty workouts are allowed: `GET /workouts` now `LEFT JOIN`s, so a workout with no sets is one row with every set column `null`; `GET /workouts/:id` gives `sets: []`.
- [ ] No route adds a set to an existing workout (`POST /workouts/:id/sets`), so an emptied workout can't be refilled yet.
- [ ] Weight ≥ 10000 is a 500 (Postgres `NUMERIC(6,2)` overflow) on `POST /workouts` and `PATCH .../sets/:setId`. Add an upper bound to the guards.
- [ ] `set_number` is client-supplied with no uniqueness or contiguity; deleting a set leaves gaps (1, 3) and duplicates are possible. Decide when adding/reordering sets in the app.
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

## Later
- Other activity types: climbing, running, swimming.
- Offline logging with SQLite on the device, plus sync to the server.
- Publish to the App Store and Google Play.
- Move config like `JWT_SECRET` into `src/config.ts`.
- Linting on the backend.
- Split routes further into controllers → services → repositories (per Notes.md), only if route files get hard to work with.
