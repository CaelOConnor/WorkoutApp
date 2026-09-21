# Architecture decisions

- Mobile: Expo (React Native) + TypeScript, Expo Router
- Backend: Node/Express, routes -> controllers -> services -> repositories -> db
- DB: PostgreSQL
- Data access: TBD - raw SQL vs Prisma
- Auth: JWT, stored in Expo SecureStore on mobile
- Charts: Victory Native or react-native-gifted-charts
- Local dev: Docker Compose (postgres + backend)

## Core tables
- users
- exercises
- workouts
- sets