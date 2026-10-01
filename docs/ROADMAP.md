# Roadmap

## Next
- [ ] **Auth middleware**: verify the JWT on protected routes and expose a typed `req.user`. Use its id instead of the hard-coded `user_id` 1 in `POST /workouts`.
- [ ] **Scope `GET /workouts` to the logged-in user**: it currently returns every user's workouts and needs no token.
- [ ] **Weight as a number**: `pg` returns `NUMERIC` as a string (`"135.00"`). Parse it (or register a pg type parser) and change `WorkoutSet.weight` to `number`.
- [ ] **Type the mobile app properly**: the screens are `.tsx` already, but `fetch` responses are `any`. Reuse `backend/src/types/models.ts` (shared package or path alias) and validate responses.
- [ ] **Progress charts**: the core feature. Add an endpoint for per-exercise history (e.g. top weight or volume per date) and a chart screen (Victory Native or react-native-gifted-charts, per Notes.md).

## Also noticed
- `POST /workouts` with an unknown `exercise_id` hits a foreign-key error (23503) and returns 500; it should return 400.
- `GET /workouts` uses an inner `JOIN`, so a workout with no sets disappears. `sets: []` is currently accepted.
- Signup has no email format or minimum password length check.
- `seed.ts` inserts exercises with no conflict check, so running it twice duplicates them.
- Mobile: `API_URL` is a placeholder in `signup.tsx`. There's no login screen and no token storage (Expo SecureStore). Home/Explore are still Expo template screens.
- `docker-compose.yml`: `depends_on` doesn't wait for Postgres to be ready; add a healthcheck.
- All routes live in one file. Notes.md plans routes → controllers → services → repositories; split when it starts to hurt.
- No linting on the backend.
