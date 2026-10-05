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
- [ ] Get one workout, edit a workout, delete a workout, edit or delete a single set.
- [ ] `GET /workouts` uses an inner `JOIN`, so a workout with no sets disappears, and `sets: []` is accepted. Decide which to fix (deleting the last set makes this matter).
- [ ] Signup: no email format or minimum password length check.
- [ ] All routes are in `app.ts`. Notes.md plans routes → controllers → services → repositories; split when the new routes make it hurt.

## Phase 3: App screens
- [ ] Log today's workout; history list grouped by week; workout detail with edit/delete.
- [ ] Groundwork: real `API_URL` (placeholder in `signup.tsx`), login screen, token storage (Expo SecureStore), replace the Home/Explore template screens.
- [ ] Type the app: `fetch` responses are `any`. Reuse `backend/src/types/models.ts` (shared package or path alias) and validate responses.

## Phase 4: Progress charts
- [ ] Weight as a number: `pg` returns `NUMERIC` as a string (`"135.00"`). Parse it (or register a pg type parser) and change `WorkoutSet.weight` to `number`.
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
