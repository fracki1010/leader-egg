# Multi-tenancy — El Huevo Líder

How the backend serves multiple companies ("tenants") from one deployment, how
the data is isolated, and the exact commands to operate it.

## 1. Architecture: database-per-tenant

Each tenant owns a **separate MongoDB database**. There is no `tenantId` field
on business documents and no tenant filter sprinkled across queries — isolation
is physical (separate databases) rather than logical (row filtering).

```
                         ┌──────────────────────────────┐
                         │   MongoDB / Atlas cluster      │
   MONGO_URI ───────────▶│   (one connection pool)        │
                         │                                │
                         │   PLATFORM_DB  (master)        │
                         │     Tenant                     │
                         │     EmailIndex                 │
                         │     PlatformAdmin              │
                         │                                │
                         │   leader_egg      ← tenant #1  │
                         │   tenant_acme                  │
                         │   tenant_globex                │
                         └──────────────────────────────┘
```

- **One pool.** Every database is reached through
  `mongoose.connection.useDb(dbName, { useCache: true })`, so the process opens
  a single pool against the cluster and reuses one logical `Connection` per
  database. `useCache: true` is what guarantees a database maps to exactly one
  `Connection` — and therefore exactly one compiled set of models — for the
  lifetime of the process.
- **Per-connection model compilation.** Mongoose compiles a model *onto a
  connection* (`conn.model(name, schema)`). The same schema compiled on two
  connections produces two independent models backed by two different databases.
  `src/tenancy/registry.ts` holds the 18 tenant schemas and compiles all of them
  on every tenant connection via `registerModels(conn)` (idempotent —
  `conn.models[name]` is reused).
- **AsyncLocalStorage for request scope.** `src/tenancy/context.ts` stores a
  `{ connection, tenantId }` pair in an `AsyncLocalStorage`. The `authenticate`
  middleware resolves the tenant from the JWT, opens its connection and runs the
  *entire downstream request* inside `runWithTenancy(...)`, so every model access
  during that request resolves against the tenant's database.

### Why models are connection-bound (the critical Mongoose behaviour)

A Mongoose model is **not** global. `conn.model('Product', schema)` creates a
model whose queries always target `conn`'s database. If you compiled `Product`
once on the base `mongoose.connection`, then every tenant request would read and
write the **base database** — silently, with no error. This is the single most
dangerous failure mode of a multi-tenant Mongoose app: data leaks are invisible
because the queries "work", they just hit the wrong DB.

`src/tenancy/scoped-model.ts` centralises the fix. `createScopedModel(name,
schema)` returns a **proxy** whose target model is resolved lazily on *every*
property access:

```
createScopedModel → createResolvedModel(name, schema,
  () => getCurrentConnection() ?? mongoose.connection)
```

- Inside `runWithTenancy(...)` → the tenant connection from AsyncLocalStorage.
- Otherwise → the base `mongoose.connection` (so scripts and legacy
  single-connection usage keep working unchanged).

Because model resolution is deferred to property-access time, a scoped model can
be imported at module load (before `mongoose.connect()`), and every model in the
app is created through this one helper — there is exactly one place where the
"which connection?" decision lives. Breaking a model back to `mongoose.model()`
is the bug the isolation suite is designed to catch.

Master models are the deliberate exception: `src/tenancy/master-models.ts` binds
them to `getMasterConnection` directly (never the ALS path), so a request running
inside a tenant scope can never resolve `Tenant`/`EmailIndex`/`PlatformAdmin`
against a tenant database and leak the registry into tenant data.

## 2. Master (platform) database layout

Only three collections live in `PLATFORM_DB`:

| Collection | Purpose |
| --- | --- |
| `Tenant` | Tenant registry: `name`, `slug` (immutable), `dbName` (immutable), `active`, `plan` |
| `EmailIndex` | Platform-wide **unique** email → `{ tenantId, userId }` routing key |
| `PlatformAdmin` | Platform/super-tenant admins (separate from tenant users) |

### `MONGO_URI` vs `PLATFORM_DB`

- `MONGO_URI` points at the cluster. Its path segment is the **default**
  database for `mongoose.connection` (historically `leader_egg`), kept for
  backward compatibility.
- Master data does **not** live on that default connection. It lives on the
  database named by `PLATFORM_DB` (default `leader_egg_platform`), on the same
  cluster, resolved via `useDb`:

```
MONGO_URI   = mongodb+srv://…/leader_egg          ← base pool / legacy default
PLATFORM_DB = leader_egg_platform                 ← Tenant + EmailIndex + PlatformAdmin
tenant #1   = leader_egg (dbName)                 ← existing business data, untouched
```

Tenant DB names: tenant #1 keeps `leader_egg`; every tenant provisioned through
the platform API/`provisionTenant` gets `tenant_<slug>` (e.g. slug `acme` →
`tenant_acme`).

## 3. Platform-wide-unique email (login routing)

Login does not know which tenant it is for — the user only types an email and a
password. Routing works like this:

1. `EmailIndex.findOne({ email })` (master DB) → `{ tenantId, userId }`.
   The email is **unique across the whole platform**.
2. Resolve the `Tenant` by id and reject suspended tenants (`403`).
3. Open the tenant connection and look up the `User` + verify the password
   **inside that tenant's database**.
4. Sign a JWT carrying `{ userId, role, tenantId, jti }`.

Consequences:

- The same email can only ever belong to one tenant. Creating a user whose email
  already exists on the platform fails with `409`; `register` writes the tenant
  `User` first and then the `EmailIndex`, rolling the user back if the index
  rejects a duplicate.
- Deleting a user also removes its `EmailIndex` row, so the email can be reused.
- Tokens without `tenantId`, for an unknown tenant, or for a suspended tenant
  fail closed (`401` / `401` / `403`) before any data access.

## 4. Ops runbook

All commands run from `leader-egg-back/` with `MONGO_URI` / `PLATFORM_DB` set
(or the defaults). The scripts connect directly to the cluster and never require
the API server to be running.

### Bootstrap the platform (once, idempotent)

```bash
npx tsx src/scripts/bootstrap-multitenant.ts \
  --email=admin@platform.com --password=secret123
# or via env: PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD / PLATFORM_ADMIN_NAME
```

Creates the platform admin, registers the existing `leader_egg` DB as tenant #1
(`name: El Huevo Líder`, `slug: huevo-lider`), and backfills the email index from
the tenant's existing users. It never modifies tenant business data.

### Provision a tenant

Provisioning seeds the tenant DB (10 products + inventory, walk-in customer,
admin user) and indexes the admin email. Use the platform API:

```bash
# 1) platform admin login
curl -X POST http://localhost:3000/api/v1/platform/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@platform.com","password":"secret123"}'
# → { "token": "…", "admin": { … } }

# 2) create the tenant (Bearer = platform token)
curl -X POST http://localhost:3000/api/v1/platform/tenants \
  -H "Authorization: Bearer <platform-token>" -H 'Content-Type: application/json' \
  -d '{
        "name":"Acme Corp",
        "slug":"acme",
        "adminName":"Acme Admin",
        "adminEmail":"admin@acme.com",
        "adminPassword":"acme-secret-123"
      }'
```

`dbName` is derived as `tenant_<slug>`; `slug` and `dbName` are immutable
afterwards. `PATCH /v1/platform/tenants/:id` renames (`name`) or suspends/activates
(`active`); `DELETE /v1/platform/tenants/:id` deprovisions with `{ "confirm": "<slug>" }`.

### Seed a tenant

```bash
npm run seed -- --tenant acme
# optionally create/reconcile the tenant admin:
npm run seed -- --tenant acme --email admin@acme.com --password secret123 --role admin
```

The seed is idempotent (products + inventory + walk-in customer). Tenant #1
(`huevo-lider`) keeps the historical seed (legacy superadmin + demo puesto user);
every other tenant seeds products + walk-in and creates an admin only when
`--email` is given (role defaults to `admin`). A bare positional slug also works:
`npm run seed -- acme`.

### Reset a tenant (destructive)

```bash
npm run tenant:reset -- --tenant acme --confirm acme
# also reset non-admin users:
npm run tenant:reset -- --tenant acme --confirm acme --include-users
```

Drops the tenant's business collections (keeps `users` + `products`), resets
counters and Punto Cero. `--tenant` is mandatory and `--confirm` must equal the
slug; it refuses to touch the platform database. There is no undo.

### Promote an admin

```bash
npm run tenant:promote -- --tenant acme --email user@acme.com
```

Sets the user's role to `admin` inside the tenant DB. The user must log out and
back in to receive a token carrying the new role. (The old
`promote-superadmin.ts` is a deprecation stub; tenant `superadmin` is retired.)

### List tenants

```bash
npm run tenants:list
```

Prints the platform DB name and a table of `name / slug / dbName / active /
createdAt`.

## 5. Isolation guarantee and its guard

**Guarantee:** a request authenticated with a tenant token can only read and
write that tenant's database. Cross-tenant references do not resolve (a 404, not
another tenant's document), tokens without a valid/active tenant fail closed, and
the platform database never receives tenant business data.

The guard is the end-to-end suite
[`src/__tests__/tenant-isolation.test.ts`](../src/__tests__/tenant-isolation.test.ts).
It provisions two tenants (`acme`, `globex`) through the real provisioning path
and drives the real Express app with supertest against an in-memory MongoDB. It
asserts exact, deterministic product id sets (zero overlap), customer scoping,
write confinement, login routing to distinct `tenantId`s, fail-closed behaviour
(missing tenant → 401, suspended tenant → 403), cross-tenant ObjectId misses
(404), and that the executed path hits `tenant_acme` / `tenant_globex` — never
the platform database. If the scoped-model resolution breaks, this suite fails.

Run it directly:

```bash
NODE_OPTIONS=--max-old-space-size=6144 npx vitest run src/__tests__/tenant-isolation.test.ts
```

## 6. Known limitations

- **Workbox runtime cache (frontend).** The `/api/v1/routes` `NetworkFirst`
  runtime cache is scoped per tenant via a Workbox `cacheKeyWillBeUsed` plugin in
  `vite.config.ts`. A service worker cannot read the page's `localStorage`, so the
  tenant is derived from the bearer JWT payload (`tenantId`), mirroring the
  `tenant_<id>` / `legacy` namespace from
  `src/lib/offline-namespace.ts`. Requests without a tenant token share the
  `legacy` key, exactly like the offline IndexedDB layer.
- **Tenant #1 legacy offline namespace.** A device that cached data before
  multi-tenancy keeps the historical `driver-pwa-db` IndexedDB namespace until it
  re-authenticates; tenant #1's offline data is not proactively migrated to
  `driver-pwa-db__tenant_<id>`. Online behaviour is unchanged (network-first), and
  the first offline load after re-login starts from a fresh cache.
- **`listTenants` per-tenant count cost.** `GET /v1/platform/tenants` returns a
  best-effort `userCount` per tenant by opening each tenant connection and running
  `User.countDocuments()` (in parallel). For a large number of tenants this is O(n)
  queries per list call; `userCount` is `null` when a tenant DB is unreachable.
