# REVIEW.md — leader-egg

Read this first when reviewing a change in this repository. It is specific to this project and follows `02-DOCS/wiki/sdd/constitution.md`.
Status: ratified with the constitution, v1.0.0 (2026-11-22).

## What failure looks like here

1. **Tenant leak.** A query on customer, account, order or user data that does not go through the tenant-scoped models in `leader-egg-back/src/tenancy/`. One tenant could read another's data.
2. **Unprotected data route.** A route that reads or writes customer, account, order or user data without the auth middleware in `leader-egg-back/src/modules/auth/middleware.ts`.
3. **Money logic without a test.** A change to balances, debts, credit limits, payment allocation or due dates (`leader-egg-back/src/modules/orders/credit-service.ts`, `payments`, `customer-charges`, `cash`) that is not covered by a test in `leader-egg-back/src/__tests__/`.
4. **Sensitive data exposed.** A response that includes a password hash, or a log line that includes a phone number, address or location.

## Paths to skip

- `node_modules/`, `dist/`, `.backups/` (local history, never pushed)
- Build output in `leader-egg-front/dist/` (for example `sw.js` and `workbox-*.js`)
- `package-lock.json` files, unless the change is a dependency change

## Nit cap

Report at most **3** nits per review. Drop the rest.

## Always-human paths

A person must review these before merge, whatever the size of the change:

- `leader-egg-back/src/modules/auth/`
- `leader-egg-back/src/tenancy/`
- `leader-egg-back/src/modules/whatsapp/`
- `leader-egg-back/src/modules/orders/credit-service.ts`
- Any `.gitignore` change, and any new `.env` file

_Enforcement gap: `.rsc/sello-config.json` does not exist yet, so `rsc risk` cannot read this list. It is a convention until that file is created._

## Summary format

Start every review with a count: "N findings: X blocker, Y nits". Then list the findings.
