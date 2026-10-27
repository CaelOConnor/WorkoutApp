# Design decisions

The main choices in this project and why they were made. Next steps and known issues are in [ROADMAP.md](ROADMAP.md).

## Data and types

- **One shared types file.** `backend/src/types/models.ts` is used by the backend and imported by the app (type-only, through the `@shared/models` alias), so the two can't disagree about the shape of a request or response. It imports nothing server-only, because the app compiles it too.
- **`PublicUser` is picked from `User`.** `Pick<User, 'id' | 'email'>` is what routes send back, so the password hash can't be sent by accident.
- **Workout dates are `'YYYY-MM-DD'` strings, not JS `Date`s.** A pg type parser returns `DATE` columns as text, so a time zone conversion can't move a workout onto another day.
- **Weights are `NUMERIC(6,2)` in Postgres and parsed to numbers.** Every value up to 9999.99 with two decimals fits a JS number exactly. The API rejects weights the column would overflow or round, instead of storing a different number.

## API

- **One error shape: `{ error: string }`.** Every error the API sends has this shape, including an unknown URL (404) and malformed JSON (400), so the app reads errors in one place.
- **In a PATCH, a missing field means "leave unchanged", and `null` clears a nullable field.** The app can send only what changed, and clearing a workout's notes is different from not touching them.
- **The date is required when creating a workout.** Only the phone knows the user's local day; the server's "today" is UTC, which is already tomorrow on a US evening. A set's unit still defaults to `lb` on the server.
- **The server owns set numbers.** Each exercise's sets in a workout are numbered 1, 2, 3, and later sets move down after a delete. A client-sent `set_number` is rejected, so there is only one source of truth.
- **A set's exercise can't be changed.** To fix one, delete the set and add a new one under the right exercise. This keeps set numbering and exercise order simple.
- **Responses include exercise names and nest sets inside workouts.** A screen gets everything it needs from one request.
- **Most write routes return the updated resource.** Workout, set and template writes return the full workout or template, and creating an exercise returns the exercise. `POST /workouts` returns only `{ id }`, and deletes return 204. The app uses the returned template and exercise, but refetches after workout and set changes.
- **Templates are replaced whole with PUT.** The edit screen already has the whole template, and replacing the exercise list makes reordering simple.
- **Emails are trimmed and lowercased at signup and login.** "Cael@Test.com " and "cael@test.com" are the same account. A migration normalized existing emails.

## Database

- **Exercise order in a workout is stored** (`workout_exercises.position`), not worked out from the sets. Deleting a set can't move an exercise's card.
- **Templates store set counts only, no reps or weights.** Starting a workout fills in the numbers from the last time each exercise was logged.
- **Starting a workout copies the template.** Workouts aren't linked to templates, so editing or deleting a template never changes a past workout.
- **Writes that must succeed together run in a transaction.** Writes that change set numbers first lock the workout row (`SELECT ... FOR UPDATE`), so simultaneous requests take turns instead of both saving "set 4". Template edits lock the template row the same way.
- **`created_by IS NULL` marks a built-in exercise.** A custom exercise stores the user who created it. Names are unique per owner, ignoring case.
- **Migrations are plain SQL, managed by node-pg-migrate.** A migration that has run is never edited; changes go in a new one. Data migrations are tested in a scratch schema.

## Security

- **Every query filters on the logged-in user's id.** Another user's workout or template gets the same 404 as a missing id, so its existence isn't revealed.
- **Database triggers stop sets, workout exercises and templates from using another user's custom exercise.** The check lives in the database, so no code path can skip it.
- **Passwords are hashed with bcrypt.** Login gives the same message for a wrong email and a wrong password, so the login screen can't be used to find out who has an account.
- **JWTs are verified with the algorithm pinned to HS256.** A token can't choose how it is checked.
- **Request logs record only the method, URL, status and time.** They never record bodies or headers, which contain passwords and tokens. The URL includes the query string (for example `?unit=kg`).

## Mobile app

- **Every response is checked by a type guard.** The app's guards allow extra keys, so a newer server adding a field doesn't break an older app. The server's guards reject unknown keys, so a typo in a request is a 400 instead of being silently ignored.
- **Failed reads retry only for network errors and 5xx.** A 4xx would fail the same way again. Saves are never retried automatically, so a timeout can't save something twice.
- **4xx messages from the API are shown to the user; 5xx messages are replaced with a generic one.** The API writes its 4xx messages for the user ("Email already in use"), while a 5xx message describes a server bug.
- **In development, the API address comes from the computer serving the app.** The app uses the Metro host's LAN IP and port 3000, so a changed IP needs no config change. `EXPO_PUBLIC_API_URL` overrides it.
- **Estimated 1RM was removed.** The progress chart defaults to the heaviest set, with volume as the second option.

## Testing

- **Test-first.** A failing test is written and run before the code that makes it pass. When a test passed straight away, I broke the code on purpose by hand to confirm the test then fails, so a test that can't fail isn't trusted.
- **Backend tests run in a Linux container against a separate test database.** Vitest had an intermittent worker crash on Windows (see Known issues in the roadmap). The test database runs in its own container, so tests never touch development data.
