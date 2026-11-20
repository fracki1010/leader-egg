# Leader Egg Backend

Minimal production-oriented TypeScript API using Express 5 and MongoDB through Mongoose.

## Setup

Requirements: Node.js 20+ and MongoDB, or Docker and Docker Compose.

```bash
cp .env.example .env
npm install
npm run dev
```

For a local MongoDB instance, the default URI is `mongodb://127.0.0.1:27017/leader_egg`.

### Docker

```bash
docker compose up --build
```

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port from 1 to 65535 |
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/leader_egg` | MongoDB connection URI (base cluster) |
| `PLATFORM_DB` | `leader_egg_platform` | Platform (master) database name |
| `CORS_ORIGIN` | `*` | `*` or an absolute URL |

Invalid values stop startup with a readable configuration error.

### Multi-tenant database layout

`MONGO_URI` points at the cluster; its path is the **default** database used by
`mongoose.connection` (kept for backward compatibility). Multi-tenant master
data lives in a **separate database on the same cluster**, resolved through
`useDb`:

- Platform DB (`PLATFORM_DB`, default `leader_egg_platform`): `Tenant`,
  `EmailIndex`, `PlatformAdmin` — never tenant business data.
- Tenant DBs: one per tenant (`dbName`, e.g. `tenant_<slug>`). The existing
  `leader_egg` database is registered as tenant #1 (`dbName: 'leader_egg'`) so
  its data is untouched.

Master models are bound to the platform connection (never the AsyncLocalStorage
tenant path), so they can never leak into a tenant database. Run
`npx tsx src/scripts/bootstrap-multitenant.ts` once to create the platform
admin, register `leader_egg` as tenant #1 and backfill the email index.

## Multi-tenancy

The backend is **database-per-tenant**: each company has its own MongoDB
database, resolved per request through AsyncLocalStorage + per-connection model
compilation. The platform (master) database only holds the tenant registry, the
platform-wide email index, and platform admins.

Full architecture, the model-connection contract, and the complete ops runbook
(bootstrap, provisioning, seeding, resetting, promoting admins, listing tenants)
live in [`docs/MULTITENANCY.md`](docs/MULTITENANCY.md). The isolation guarantee is
guarded end-to-end by
[`src/__tests__/tenant-isolation.test.ts`](src/__tests__/tenant-isolation.test.ts).

## Scripts

- `npm run dev`: Run the server with `tsx` watch mode.
- `npm run build`: Compile TypeScript into `dist`.
- `npm start`: Run the compiled server.
- `npm run lint`: Type-check without emitting files.
- `npm test`: Placeholder until tests are added.

## Endpoints

- `GET /api/health`: Returns service status, an ISO timestamp, and Mongoose database readiness.
- Unknown routes return `404` with a JSON error.

## Architecture

- `src/app.ts`: Express application construction, middleware, routes, and error handling. It does not connect to MongoDB.
- `src/server.ts`: Runtime entry point, environment loading, database connection, HTTP listener, and graceful shutdown.
- `src/config/env.ts`: Strict environment validation with Zod.
- `src/config/database.ts`: Mongoose connection lifecycle helpers.
- `src/routes/index.ts`: API route registration and health endpoint.
