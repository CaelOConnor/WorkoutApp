# WorkoutApp

A mobile workout tracker. You log a workout as exercises with sets of reps and weight, look back through your history, and chart your progress on any exercise over time. Templates let you start a common workout in one tap, with the numbers from last time already filled in. I built it to learn TypeScript, test-driven development and mobile development. It has an Expo (React Native) app, an Express API and a PostgreSQL database, all written in strict TypeScript and built test-first.

<!-- Screenshots: History, Log workout, Workout detail, Progress chart, Templates -->
_Screenshots coming soon._

<!-- Demo video link -->
_Demo video: coming soon._

## Features

- Sign up and log in. The token is stored in the phone's secure storage.
- Log a workout: pick a date, add exercises, enter reps and weight for each set (lb or kg), and add notes.
- Grey hints show what you lifted last time for each exercise.
- History grouped by week. Open a workout to edit its date and notes, or add, edit and delete sets.
- Add your own exercises alongside the built-in ones.
- Templates (for example "Leg day"): a list of exercises with a number of sets. Starting one fills in last time's numbers.
- Progress charts per exercise: heaviest set or total volume, in lb or kg, over the last 3 months, 6 months, year, or all time.

## Tech stack

- **App:** Expo SDK 57, React Native, Expo Router, TanStack Query, Victory Native (charts)
- **API:** Node 24, Express 5, TypeScript (strict), JWT auth with bcrypt password hashes
- **Database:** PostgreSQL 16 with raw SQL through `pg` (no ORM), and plain-SQL migrations with node-pg-migrate
- **Tests:** Vitest and supertest (API), Jest and React Native Testing Library (app)
- **Local setup:** Docker Compose

## Running it locally

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js](https://nodejs.org/) 24 and npm
- The [Expo Go](https://expo.dev/go) app on an iPhone or Android phone, on the same Wi-Fi network as your computer

### 1. Configure the backend

Copy `backend/.env.example` to `backend/.env` and set `JWT_SECRET` to any long random string. The other values work as they are for local development; each one is explained in the file.

### 2. Start the database and API

From the repository root:

```
docker compose up --build
```

This starts PostgreSQL and the API on port 3000. The API applies any pending migrations when it starts. Open http://localhost:3000 to check it's running.

### 3. Seed the built-in exercises

```
cd backend
npm install
npm run seed
```

Optional: after signing up in the app (step 4), `npm run seed:sample -- you@example.com` adds about three weeks of sample workouts to that account, so the history and charts have data.

### 4. Start the app

```
cd mobile
npm install
npm start
```

Scan the QR code with the Camera app (iPhone) or with Expo Go (Android). In development, the app finds the API at your computer's address on port 3000. To point it somewhere else, set `EXPO_PUBLIC_API_URL` in `mobile/.env.local`.

### Windows firewall

On Windows, the firewall may block your phone from reaching the API. The app then shows a network error. Allow inbound connections on port 3000 for private networks, for example from an administrator PowerShell:

```
New-NetFirewallRule -DisplayName "WorkoutApp API" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
```

Your Wi-Fi network also needs to be set to Private in Windows settings.

## Running the tests

Backend (needs Docker Desktop running). The tests run in a Linux container against a separate test database:

```
cd backend
npm test
npm run typecheck
```

App:

```
cd mobile
npm test
npm run typecheck
npm run lint
```

## Project structure

```
backend/
  src/routes/        Express routers: auth, workouts and sets, exercises, templates
  src/db/            Database pool and shared queries
  src/validation.ts  Runtime checks for request bodies
  src/types/         Types shared with the app
  migrations/        SQL migrations
  test/              API and migration tests
mobile/
  src/app/           Screens (Expo Router, one file per route)
  src/api/           API client and response checks
  src/auth/          Login state and token storage
  src/workouts/      Data hooks and screen logic
  src/components/    Shared UI components
docs/
  DECISIONS.md       Design decisions and the reasons for them
  ROADMAP.md         What's done, next steps and known issues
docker-compose.yml   Database, API and test services
```

## More

- [Design decisions](docs/DECISIONS.md)
- [Roadmap](docs/ROADMAP.md)

## License

MIT. See [LICENSE](LICENSE).
